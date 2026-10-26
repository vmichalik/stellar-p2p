import {
  readFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { Keypair, Networks, rpc } from '@stellar/stellar-sdk';
import { createEd25519SigningAdapter } from '../policy/src/index.mjs';
import { normalizedVerifiedPayment } from '../policy/src/tlsn-store.mjs';
import { createLivePaymentSupport } from './live-payments.mjs';
import { createMainnetBootstrap, savePrivateJson } from './mainnet-bootstrap.mjs';
import { createHostRuntime } from './host-runtime.mjs';
import { createLiveServer } from './live-server.mjs';

const check = (ok, code) => {
  if (!ok) throw Error(code);
};
const MAINNET_RPC = 'https://soroban-rpc.mainnet.stellar.gateway.fm';
const TOKEN = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const APP_ORIGIN = 'https://pactlane.io';
const PROOF_ORIGIN = 'https://stellar-p2p-proof-vijay.fly.dev';
const app = resolve(import.meta.dirname, '../app');
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

/** One owner-approved trade, with operator configuration supplied only on disk. */
export async function createLiveOperator({
  directory,
  evidenceDirectory,
  evidenceStore,
  proofHealth,
}) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const ownerPath = join(directory, 'owner.json');
  const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
  check(
    owner.maximumTestUSDC === '1' &&
      owner.fiatMinor === '89' &&
      owner.rolesConfirmed &&
      owner.bankRecipientConfirmedAsSeller &&
      typeof owner.destination === 'string' &&
      /^@[a-zA-Z0-9._]{3,30}$/.test(owner.destination) &&
      owner.deploymentFeeCapStroops === '250000000' &&
      owner.feeCapApproved,
    'OWNER_APPROVAL_REQUIRED',
  );
  const keyPath = join(directory, 'policy-seed');
  if (!existsSync(keyPath)) {
    check(
      owner.initializeSigner === true && !existsSync(join(directory, 'deployment-journal.json')),
      'SIGNER_CREATION_NOT_APPROVED',
    );
    const fd = openSync(keyPath, 'wx', 0o600);
    try {
      writeFileSync(fd, randomBytes(32));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  chmodSync(keyPath, 0o600);
  const key = Keypair.fromRawEd25519Seed(readFileSync(keyPath));
  if (owner.initializeSigner) {
    delete owner.initializeSigner;
    savePrivateJson(ownerPath, owner);
  }
  const signer = createEd25519SigningAdapter({
    publicKeyHex: Buffer.from(key.rawPublicKey()).toString('hex'),
    signDigest: async (digest) => key.sign(digest),
  });
  const bindingPath = join(directory, 'bank-binding.json');
  if (!existsSync(bindingPath)) {
    // Accepted evidence stays private. The owner has reviewed this association;
    // the historical payment anchors identity only, never the new order's payment.
    const db = new DatabaseSync(join(evidenceDirectory, 'verified-payments.sqlite'), {
      readOnly: true,
    });
    let ids;
    try {
      ids = db.prepare('SELECT id FROM tlsn_payment_records ORDER BY received_at,id').all();
    } finally {
      db.close();
    }
    check(ids.length > 0, 'ACCEPTED_BANK_RECORD_REQUIRED');
    const anchor = normalizedVerifiedPayment(evidenceStore.reader.readVerifiedRecord(ids[0].id));
    for (const row of ids) {
      const record = normalizedVerifiedPayment(evidenceStore.reader.readVerifiedRecord(row.id));
      check(
        record.recipientId === anchor.recipientId && record.payerScope === anchor.payerScope,
        'BANK_BINDING_AMBIGUOUS',
      );
    }
    savePrivateJson(bindingPath, {
      network: 'mainnet',
      token: TOKEN,
      seller: owner.accounts[0],
      buyer: owner.accounts[1],
      recipientId: anchor.recipientId,
      payerScope: anchor.payerScope,
      evidenceId: ids[0].id,
      recipientSalt: randomBytes(32).toString('hex'),
      destination: owner.destination,
      tokenAmount: '10000000',
      fiatMinor: '89',
    });
  }
  const binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
  check(
    binding.seller === owner.accounts[0] &&
      binding.buyer === owner.accounts[1] &&
      binding.destination === owner.destination,
    'OWNER_BINDING_CHANGED',
  );
  const support = createLivePaymentSupport({
    binding,
    evidenceReader: evidenceStore.reader,
    signer,
    authorizationPath: join(directory, 'authorizations.sqlite'),
    proofHealth,
  });
  const server = new rpc.Server(MAINNET_RPC);
  server.httpClient.defaults.timeout = 15000;
  let live = await createLiveServer({ publicOrigin: APP_ORIGIN }),
    activeContract = null;
  const configPath = join(directory, 'exchange.json');
  async function activate(receipt) {
    if (activeContract === receipt.contract) return;
    let config;
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf8'));
      check(
        config.deployment.contract === receipt.contract &&
          config.deployment.policySignerPublicKeyHex === signer.publicKeyHex,
        'DEPLOYMENT_CONFIG_CHANGED',
      );
    } else {
      config = {
        deployment: {
          network: 'mainnet',
          networkPassphrase: Networks.PUBLIC,
          rpcUrl: MAINNET_RPC,
          contract: receipt.contract,
          token: TOKEN,
          tokenDecimals: 7,
          tokenLabel: 'USDC',
          asset: { code: 'USDC', issuer: ISSUER },
          policySignerPublicKeyHex: signer.publicKeyHex,
          escrowWasmSha256: '8940569853b21a957fc5a81402666e95ed75f054ce2223926231ffc2c0c506dd',
          maxFeeStroops: '10000000',
          allowMainnetSubmission: true,
          protocolVersion: 29,
        },
        deploymentLedger: receipt.ledger,
        sellerDrafts: [
          {
            id: 'first-trade',
            publicTerms: {
              seller: binding.seller,
              token_amount: '10000000',
              fiat_minor: '89',
              currency: 'EUR',
              rail: 'revolut',
              recipient: support.recipientCommitment,
              offer_expires_at: String(Math.floor(Date.now() / 1000) + 6 * 3600),
              reservation_seconds: '3600',
            },
          },
        ],
      };
      savePrivateJson(configPath, config);
    }
    const runtime = createHostRuntime({
      ...config,
      storageDirectory: join(directory, 'exchange'),
      replayStorePath: join(directory, 'payment-replay.sqlite'),
      paymentSupport: support,
      submissionEnabled: true,
    });
    // The first read verifies the deployed WASM, token, signer and RPC domain.
    const view = await runtime.readView({ account: binding.seller });
    check(
      view.configured && view.readiness.submission && view.readiness.paymentProof,
      'DEPLOYMENT_NOT_READY',
    );
    const next = await createLiveServer({ publicOrigin: APP_ORIGIN, runtime });
    live.close();
    live = next;
    activeContract = receipt.contract;
  }
  const bootstrap = createMainnetBootstrap({
    directory,
    owner: binding.seller,
    token: TOKEN,
    signerPublicKeyHex: signer.publicKeyHex,
    wasm: await readFile(
      resolve(import.meta.dirname, '../contracts/escrow/artifacts/pactlane_escrow.wasm'),
    ),
    feeCapStroops: owner.deploymentFeeCapStroops,
    server,
    onDeployed: activate,
  });
  await bootstrap.status();
  const assets = new Map([
    ['/setup', ['mainnet-setup.html', 'text/html; charset=utf-8']],
    ['/setup/mainnet-setup.mjs', ['mainnet-setup.mjs', 'text/javascript; charset=utf-8']],
    ['/setup/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/setup/live-styles.css', ['live-styles.css', 'text/css; charset=utf-8']],
    ['/assets/fonts/manrope.woff2', ['assets/fonts/manrope.woff2', 'font/woff2']],
  ]);
  const send = (res, status, body, type) =>
    res.writeHead(status, { ...headers, ...(type ? { 'Content-Type': type } : {}) }).end(body);
  return Object.freeze({
    handles(url) {
      return (
        url?.startsWith('/api/') ||
        url?.startsWith('/bootstrap/') ||
        assets.has(url) ||
        url === '/setup/freighter-api.js'
      );
    },
    async handler(req, res) {
      try {
        check(req.headers.host === new URL(PROOF_ORIGIN).host, 'HOST_REJECTED');
        if (req.url.startsWith('/api/')) {
          // Fixed reverse-proxy destination. Keep the browser Origin intact: the
          // bridge still requires pactlane.io for writes and wallet authentication.
          req.headers.host = new URL(APP_ORIGIN).host;
          return live.handler(req, res);
        }
        check(!req.headers.origin || req.headers.origin === PROOF_ORIGIN, 'ORIGIN_REJECTED');
        if (req.url === '/bootstrap/status' && req.method === 'GET')
          return send(res, 200, JSON.stringify(await bootstrap.status()));
        if (
          ['/bootstrap/prepare', '/bootstrap/submit'].includes(req.url) &&
          req.method === 'POST'
        ) {
          check(
            req.headers.origin === PROOF_ORIGIN &&
              req.headers['content-type'] === 'application/json',
            'ORIGIN_REJECTED',
          );
          let body = '';
          req.setTimeout(10000, () => req.destroy());
          for await (const part of req) {
            body += part;
            check(Buffer.byteLength(body) < 110000, 'BODY_TOO_LARGE');
          }
          const input = JSON.parse(body);
          check(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT');
          const result = req.url.endsWith('/prepare')
            ? (check(Object.keys(input).length === 0, 'INVALID_INPUT'), await bootstrap.prepare())
            : (check(
                Object.keys(input).length === 1 && Object.hasOwn(input, 'signedXdr'),
                'INVALID_INPUT',
              ),
              await bootstrap.submit(input.signedXdr));
          return send(res, 200, JSON.stringify(result));
        }
        check(req.method === 'GET', 'METHOD_REJECTED');
        if (req.url === '/setup/freighter-api.js')
          return send(
            res,
            200,
            await readFile(
              new URL('node_modules/@stellar/freighter-api/build/index.min.js', import.meta.url),
            ),
            'text/javascript; charset=utf-8',
          );
        const asset = assets.get(req.url);
        check(asset, 'NOT_FOUND');
        return send(res, 200, await readFile(join(app, asset[0])), asset[1]);
      } catch (error) {
        const code =
          typeof error.message === 'string' && /^[A-Z_]{3,80}$/.test(error.message)
            ? error.message
            : 'SETUP_UNAVAILABLE';
        if (!res.headersSent) send(res, 400, JSON.stringify({ error: code }));
      }
    },
    close() {
      live.close();
      support.close();
    },
  });
}
