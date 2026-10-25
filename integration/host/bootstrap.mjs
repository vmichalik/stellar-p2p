import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Networks, rpc } from '@stellar/stellar-sdk';
import {
  ReplayStore,
  createEd25519SigningAdapter,
  createLivePaymentPolicy,
  escrowDomainKey,
  recipientCommitment,
} from '../../policy/src/index.mjs';
import { TransactionJournal } from '../transaction-journal.mjs';
import { createStellarServices } from '../stellar-rpc-adapter.mjs';
import { createEscrowIndexer } from './indexer.mjs';
import { createStellarReaders } from './stellar-reader.mjs';
import { createCapability, createHostHttpServer, createWalletRequestBridge } from './http-api.mjs';
import {
  createPolicyHostPort,
  PolicyAuthorizationStore,
  wrapReceiptReconciliation,
} from './policy-port.mjs';
import {
  loadDeployment,
  loadPrivateOfferConfig,
  loadSigningKey,
  sanitizedConfig,
} from './config.mjs';

const requireValue = (value, code) => {
  if (!value) throw new Error(code);
  return value;
};

export function bootstrapHost({
  deploymentPath,
  privateOfferPath,
  signingKeyPath = null,
  stateDirectory,
  verifierReader,
  proof,
  paymentStatus,
  manualResolutionReader,
  origin,
  server = null,
}) {
  requireValue(
    deploymentPath && privateOfferPath && stateDirectory && origin,
    'HOST_CONFIGURATION_REQUIRED',
  );
  const deployment = { ...loadDeployment(deploymentPath) };
  deployment.privateOffer = loadPrivateOfferConfig(privateOfferPath, deployment.contract);
  const signer = signingKeyPath
    ? createEd25519SigningAdapter(
        loadSigningKey(signingKeyPath, deployment.policySignerPublicKeyHex),
      )
    : null;
  const unavailable = async () => {
    throw new Error('LIVE_PAYMENT_VALIDATION_PENDING');
  };
  const verifier = verifierReader ?? { readVerifiedRecord: unavailable };
  const proofPort = proof ?? { launchProof: unavailable };
  const statusPort = paymentStatus ?? {
    readStatus: async () => ({
      releaseGate: 'NOT_CLEARED',
      status: 'LIVE_PAYMENT_VALIDATION_PENDING',
    }),
  };
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  chmodSync(stateDirectory, 0o700);
  const rpcServer = server ?? new rpc.Server(deployment.rpcUrl);
  const store = new ReplayStore(join(stateDirectory, 'policy-replay.sqlite'), {
    syntheticOnly: false,
  });
  try {
    store.bindDomain(
      escrowDomainKey({ network_passphrase: Networks.TESTNET, contract: deployment.contract }),
    );
  } catch (error) {
    store.close();
    throw error;
  }
  const journal = new TransactionJournal(join(stateDirectory, 'transactions.sqlite'));
  const authorizationStore = new PolicyAuthorizationStore(
    join(stateDirectory, 'policy-authorizations.sqlite'),
  );
  const walletBridge = createWalletRequestBridge();
  const readers = createStellarReaders({
    deployment,
    server: rpcServer,
    readerAccount: () => deployment.readerAccount,
  });
  const indexer = createEscrowIndexer({ deployment, store, server: rpcServer });
  const policyLedgerReader = Object.freeze({
    async readOrder(args) {
      const snapshot = await readers.readOrder(args);
      await indexer.syncOnce();
      return snapshot;
    },
  });
  const policy = signer
    ? createLivePaymentPolicy({
        domain: { network_passphrase: Networks.TESTNET, contract: deployment.contract },
        ledgerReader: policyLedgerReader,
        verifierReader: verifier,
        store,
        signer,
        manualResolutionReader,
      })
    : null;
  const policyPort = createPolicyHostPort({
    policy,
    store: authorizationStore,
    domain: { network_passphrase: Networks.TESTNET, contract: deployment.contract },
    signerPublicKeyHex: deployment.policySignerPublicKeyHex,
    readStatus: statusPort.readStatus,
  });
  const instructions = Object.freeze({
    async read({ orderId, recipientCommitment: expected }) {
      const privateOffer = deployment.privateOffer;
      const calculated = recipientCommitment({
        recipient_id: privateOffer.recipientId,
        recipient_salt: privateOffer.recipientSalt,
      }).toString('hex');
      if (calculated !== expected || (privateOffer.orderId && privateOffer.orderId !== orderId))
        throw new Error('PAYMENT_DESTINATION_UNAVAILABLE');
      const snapshot = await readers.readOrder({
        domain: { network_passphrase: Networks.TESTNET, contract: deployment.contract },
        orderId,
      });
      if (
        snapshot.order.terms.seller !== privateOffer.seller ||
        snapshot.order.terms.recipient !== calculated
      )
        throw new Error('PAYMENT_DESTINATION_UNAVAILABLE');
      return {
        orderId,
        recipientCommitment: expected,
        sourceBindingVerified: true,
        destination: privateOffer.destination,
      };
    },
  });
  const baseService = createStellarServices({
    deployment,
    wallet: walletBridge.wallet,
    server: rpcServer,
    journal,
    policy: {
      launchProof: proofPort.launchProof,
      readStatus: policyPort.readStatus,
      readAuthorization: policyPort.readAuthorization,
    },
    instructions,
    submissionEnabled: deployment.submissionEnabled === true,
  });
  const service = wrapReceiptReconciliation(baseService, policyPort, { enabled: Boolean(policy) });
  const capability = createCapability();
  const http = createHostHttpServer({
    service,
    deployment: { publicConfig: sanitizedConfig(deployment) },
    origin,
    capabilities: [capability],
    walletBridge,
    policyPort,
    staticRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  });
  return Object.freeze({
    capability,
    deployment,
    service,
    policy,
    policyPort,
    readers,
    indexer,
    store,
    authorizationStore,
    journal,
    http,
    close: async () => {
      await http.close();
      journal.close();
      authorizationStore.close();
      store.close();
    },
  });
}
