// Disposable local fixtures only. No network requests or funded accounts.
import { Asset, Keypair, xdr } from '@stellar/stellar-sdk';
import { NETWORKS } from '../../app/network.mjs';

export function issuedDeployment(base, network = 'testnet') {
  const asset = { code: 'UNIT', issuer: Keypair.random().publicKey() };
  return {
    ...base,
    network,
    networkPassphrase: NETWORKS[network].passphrase,
    asset,
    token: new Asset(asset.code, asset.issuer).contractId(NETWORKS[network].passphrase),
    policySignerPublicKeyHex: Buffer.from(Keypair.random().rawPublicKey()).toString('hex'),
  };
}

export function receivingEntries(
  keys,
  {
    missingAccount = false,
    missingTrustline = false,
    flags = 1,
    balance = 0n,
    limit = 9223372036854775807n,
    buying = 0n,
  } = {},
) {
  return {
    latestLedger: 100,
    entries: keys.flatMap((key) => {
      if (
        (key.type === 'account' && missingAccount) ||
        (key.type === 'trustline' && missingTrustline)
      )
        return [];
      const value =
        key.type === 'account'
          ? xdr.LedgerEntryData.account(
              new xdr.AccountEntry({
                accountId: key.account.accountId,
                balance: 10000000n,
                seqNum: 10n,
                numSubEntries: 1,
                inflationDest: null,
                flags: 0,
                homeDomain: '',
                thresholds: Buffer.from([1, 0, 0, 0]),
                signers: [],
                ext: xdr.AccountEntryExt.v0(),
              }),
            )
          : xdr.LedgerEntryData.trustline(
              new xdr.TrustLineEntry({
                ...key.trustLine,
                balance,
                limit,
                flags,
                ext: xdr.TrustLineEntryExt.v1(
                  new xdr.TrustLineEntryV1({
                    liabilities: new xdr.Liabilities({ buying, selling: 0n }),
                    ext: xdr.TrustLineEntryV1Ext.v0(),
                  }),
                ),
              }),
            );
      return [{ key, val: value, lastModifiedLedgerSeq: 95 }];
    }),
  };
}

export function sacInstance() {
  return xdr.ScVal.scvContractInstance(
    new xdr.ScContractInstance({
      executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
      storage: [],
    }),
  );
}
