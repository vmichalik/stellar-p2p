import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Address,
  Keypair,
  Networks,
  StrKey,
  xdr,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { createStellarReaders } from './stellar-reader.mjs';

const symbol = (value) => nativeToScVal(value, { type: 'symbol' });
const map = (fields) =>
  xdr.ScVal.scvMap(
    Object.entries(fields).map(
      ([key, value]) => new xdr.ScMapEntry({ key: symbol(key), val: value }),
    ),
  );
const token = StrKey.encodeContract(Buffer.alloc(32, 8));
const contract = StrKey.encodeContract(Buffer.alloc(32, 9));
const signer = 'ab'.repeat(32);

function fixture({ latestSequence = 50 } = {}) {
  const account = Keypair.random().publicKey();
  return {
    readerAccount: account,
    deployment: {
      contract,
      token,
      networkPassphrase: Networks.TESTNET,
      tokenDecimals: 7,
      policySignerPublicKeyHex: signer,
      privateOffer: { recipientSalt: '11'.repeat(32) },
    },
    server: {
      async getNetwork() {
        return { passphrase: Networks.TESTNET, protocolVersion: 29 };
      },
      async getAccount(address) {
        return new Account(address, '1');
      },
      async getLatestLedger() {
        return { sequence: latestSequence, closeTime: '1000' };
      },
      async simulateTransaction(tx) {
        const method = tx.operations[0].func.invokeContract.functionName.toString();
        const retval =
          method === 'get_order'
            ? map({ state: xdr.ScVal.scvVec([symbol('Paying')]) })
            : method === 'get_config'
              ? map({
                  token: new Address(token).toScVal(),
                  signer: xdr.ScVal.scvBytes(Buffer.from(signer, 'hex')),
                })
              : nativeToScVal(7, { type: 'u32' });
        return { transactionData: {}, latestLedger: 50, result: { retval } };
      },
    },
  };
}

test('reader normalizes the Soroban enum and requires one confirmed ledger snapshot', async () => {
  const f = fixture();
  const reader = createStellarReaders(f);
  const result = await reader.readOrder({
    domain: { network_passphrase: Networks.TESTNET, contract },
    orderId: '4',
  });
  assert.equal(result.order.state, 'Paying');
  assert.equal(result.ledgerSequence, '50');
  assert.equal(result.ledgerTimestamp, '1000');
});

test('reader rejects a latest-ledger timestamp from a different simulation ledger', async () => {
  const f = fixture({ latestSequence: 51 });
  const reader = createStellarReaders(f);
  await assert.rejects(
    reader.readOrder({ domain: { network_passphrase: Networks.TESTNET, contract }, orderId: '4' }),
    /INCONSISTENT_LEDGER_SNAPSHOT/,
  );
});
