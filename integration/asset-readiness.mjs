import { Asset, Keypair, StrKey, xdr } from '@stellar/stellar-sdk';
import { assertRpcNetwork, validateDeployment } from './deployment-config.mjs';

const check = (ok, code) => {
  if (!ok) throw Error(code);
};
const same = (a, b) => a && b && Buffer.from(a.toXDR()).equals(Buffer.from(b.toXDR()));

/** Read-only classic-asset receiving preflight. Never creates a trustline or
 * funds an account. Capacity is a snapshot, not a promise of later settlement.
 */
export async function assertReceivingReady({
  deployment,
  server,
  account,
  amount,
  clock = () => String(Math.floor(Date.now() / 1000)),
}) {
  const cfg = validateDeployment(deployment);
  check(cfg.asset, 'ASSET_IDENTITY_REQUIRED');
  check(StrKey.isValidEd25519PublicKey(account), 'RECEIVING_ACCOUNT_INVALID');
  check(account !== cfg.asset.issuer, 'ISSUER_ACCOUNT_UNSUPPORTED');
  check(
    typeof amount === 'string' &&
      /^[1-9][0-9]*$/.test(amount) &&
      amount.length <= 39 &&
      BigInt(amount) < 1n << 127n,
    'INVALID_RECEIVING_AMOUNT',
  );
  await assertRpcNetwork(cfg, await server.getNetwork());
  const publicKey = Keypair.fromPublicKey(account).xdrPublicKey();
  const asset = new Asset(cfg.asset.code, cfg.asset.issuer).toTrustLineXdrObject();
  const keys = [
    xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: publicKey })),
    xdr.LedgerKey.trustline(new xdr.LedgerKeyTrustLine({ accountId: publicKey, asset })),
  ];
  const result = await server.getLedgerEntries(...keys);
  check(
    Number.isSafeInteger(result.latestLedger) &&
      result.latestLedger > 0 &&
      Array.isArray(result.entries),
    'RECEIVING_READ_UNAVAILABLE',
  );
  const allowed = new Set(keys.map((key) => key.toXDR('base64'))),
    found = new Map();
  for (const entry of result.entries) {
    const key = entry.key.toXDR('base64');
    check(
      allowed.has(key) &&
        !found.has(key) &&
        Number.isSafeInteger(entry.lastModifiedLedgerSeq) &&
        entry.lastModifiedLedgerSeq > 0 &&
        entry.lastModifiedLedgerSeq <= result.latestLedger,
      'RECEIVING_LEDGER_MISMATCH',
    );
    found.set(key, entry.val);
  }
  const owner = found.get(keys[0].toXDR('base64'));
  const line = found.get(keys[1].toXDR('base64'));
  check(
    owner?.type === 'account' && same(owner.account.accountId, publicKey),
    'RECEIVING_ACCOUNT_MISSING',
  );
  check(line?.type === 'trustline', 'RECEIVING_TRUSTLINE_MISSING');
  const value = line.trustLine;
  check(same(value.accountId, publicKey) && same(value.asset, asset), 'RECEIVING_ASSET_MISMATCH');
  // AUTHORIZED_TO_MAINTAIN_LIABILITIES_FLAG (2) alone cannot receive a payment.
  check((value.flags & 1) === 1, 'RECEIVING_ASSET_UNAUTHORIZED');
  const buying =
    value.ext.type === 'v0' ? 0n : value.ext.type === 'v1' ? value.ext.v1.liabilities.buying : null;
  check(
    typeof buying === 'bigint' &&
      buying >= 0n &&
      typeof value.balance === 'bigint' &&
      value.balance >= 0n &&
      typeof value.limit === 'bigint' &&
      value.limit >= value.balance,
    'RECEIVING_CAPACITY_INVALID',
  );
  check(value.limit - value.balance - buying >= BigInt(amount), 'RECEIVING_CAPACITY_INSUFFICIENT');
  const ledgers = await server.getLedgers({
    startLedger: result.latestLedger,
    pagination: { limit: 1 },
  });
  const record = ledgers.ledgers?.[0],
    now = BigInt(clock());
  check(
    ledgers.ledgers?.length === 1 &&
      record.sequence === result.latestLedger &&
      typeof record.ledgerCloseTime === 'string' &&
      /^[0-9]+$/.test(record.ledgerCloseTime),
    'RECEIVING_READ_UNAVAILABLE',
  );
  const close = BigInt(record.ledgerCloseTime);
  check(close <= now && now - close <= 60n, 'RECEIVING_READ_STALE');
  return Object.freeze({
    ready: true,
    account,
    token: cfg.token,
    deploymentId: cfg.deploymentId,
    amount,
    ledger: String(result.latestLedger),
  });
}
