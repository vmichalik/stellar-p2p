import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  scValToNative,
  rpc,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';

const ensure = (value, code) => {
  if (!value) throw new Error(code);
};
const plain = (value) =>
  typeof value === 'bigint'
    ? value.toString()
    : value instanceof Uint8Array
      ? Buffer.from(value).toString('hex')
      : Array.isArray(value)
        ? value.map(plain)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]))
          : value;

export function createStellarReaders({
  deployment,
  server = new rpc.Server(deployment.rpcUrl),
  readerAccount,
}) {
  async function network() {
    const value = await server.getNetwork();
    ensure(
      value.passphrase === Networks.TESTNET && Number(value.protocolVersion) >= 29,
      'RPC_NETWORK_MISMATCH',
    );
  }
  async function simulation(method, args, contract = deployment.contract) {
    const account = typeof readerAccount === 'function' ? readerAccount() : readerAccount;
    ensure(account, 'READER_ACCOUNT_REQUIRED');
    const source = await server.getAccount(account);
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(new Contract(contract).call(method, ...args))
      .setTimeout(60)
      .build();
    const result = await server.simulateTransaction(tx);
    ensure(rpc.Api.isSimulationSuccess(result) && result.result?.retval, 'RPC_READ_FAILED');
    return {
      ledgerSequence: Number(result.latestLedger),
      value: plain(scValToNative(result.result.retval)),
    };
  }

  async function readStable(method, args, contract) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const first = await simulation(method, args, contract);
      const second = await simulation(method, args, contract);
      if (first.ledgerSequence === second.ledgerSequence)
        return { ...second, previous: first.value };
    }
    throw new Error('INCONSISTENT_LEDGER_SNAPSHOT');
  }

  return Object.freeze({
    async readOrder({ domain, orderId, nullifier = null }) {
      ensure(
        domain.network_passphrase === Networks.TESTNET && domain.contract === deployment.contract,
        'INVALID_DOMAIN',
      );
      await network();
      const id = nativeToScVal(BigInt(orderId), { type: 'u64' });
      for (let attempt = 0; attempt < 3; attempt++) {
        const reads = [
          readStable('get_order', [id], deployment.contract),
          readStable('get_config', [], deployment.contract),
          readStable('decimals', [], deployment.token),
          server.getLatestLedger(),
        ];
        if (nullifier)
          reads.push(
            readStable(
              'payment_used',
              [xdr.ScVal.scvBytes(Buffer.from(nullifier, 'hex'))],
              deployment.contract,
            ),
          );
        const [orderResult, configResult, decimalsResult, latest, usedResult] =
          await Promise.all(reads);
        const sequence = orderResult.ledgerSequence;
        if (
          [
            configResult.ledgerSequence,
            decimalsResult.ledgerSequence,
            ...(usedResult ? [usedResult.ledgerSequence] : []),
          ].some((ledger) => ledger !== sequence) ||
          latest.sequence !== sequence
        )
          continue;
        ensure(
          JSON.stringify(orderResult.value) === JSON.stringify(orderResult.previous),
          'INCONSISTENT_LEDGER_SNAPSHOT',
        );
        ensure(
          JSON.stringify(configResult.value) === JSON.stringify(configResult.previous),
          'INCONSISTENT_LEDGER_SNAPSHOT',
        );
        ensure(
          JSON.stringify(decimalsResult.value) === JSON.stringify(decimalsResult.previous) &&
            (!usedResult ||
              JSON.stringify(usedResult.value) === JSON.stringify(usedResult.previous)),
          'INCONSISTENT_LEDGER_SNAPSHOT',
        );
        ensure(
          configResult.value.token === deployment.token &&
            configResult.value.signer === deployment.policySignerPublicKeyHex,
          'CONTRACT_CONFIGURATION_MISMATCH',
        );
        ensure(
          String(decimalsResult.value) === String(deployment.tokenDecimals),
          'TOKEN_DECIMALS_MISMATCH',
        );
        const order = orderResult.value;
        const state =
          Array.isArray(order.state) && order.state.length === 1 ? order.state[0] : order.state;
        ensure(typeof state === 'string', 'CHAIN_ORDER_STATE_INVALID');
        return {
          confirmed: true,
          network_passphrase: Networks.TESTNET,
          contract: deployment.contract,
          ledgerSequence: String(sequence),
          ledgerTimestamp: String(latest.closeTime),
          order: { ...order, id: String(orderId), state },
          config: configResult.value,
          paymentUsed: Boolean(usedResult?.value ?? false),
          offerData: { recipientSalt: deployment.privateOffer.recipientSalt },
        };
      }
      throw new Error('INCONSISTENT_LEDGER_SNAPSHOT');
    },
  });
}
