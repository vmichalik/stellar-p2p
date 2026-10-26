import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import {
  createLivePaymentPolicy,
  recipientCommitment,
  isLiveSigningAdapter,
} from '../policy/src/index.mjs';
import { isTrustedTlsnReader, normalizedVerifiedPayment } from '../policy/src/tlsn-store.mjs';

const instances = new WeakSet();
export const isLivePaymentSupport = (value) => instances.has(value);
const check = (ok, code = 'PAYMENT_VERIFICATION_UNAVAILABLE') => {
  if (!ok) throw Error(code);
};
const positiveAmount = (value) =>
  typeof value === 'string' && /^[1-9][0-9]{0,38}$/.test(value) && BigInt(value) < 1n << 127n;
const usdcUnits = (atoms) => {
  const value = BigInt(atoms);
  const fraction = (value % 10000000n).toString().padStart(7, '0').replace(/0+$/, '');
  return `${value / 10000000n}${fraction ? `.${fraction}` : ''}`;
};

// Constructed by the operator from an owner-reviewed bank/wallet association.
// No HTTP request may supply these bindings, a signer, or a readiness flag.
export function createLivePaymentSupport({
  binding,
  evidenceReader,
  signer,
  authorizationPath,
  proofHealth,
  clock = () => String(Math.floor(Date.now() / 1000)),
}) {
  check(binding && isTrustedTlsnReader(evidenceReader) && isLiveSigningAdapter(signer));
  check(typeof proofHealth === 'function' && isAbsolute(authorizationPath));
  const fixed = Object.freeze(structuredClone(binding));
  check(
    StrKey.isValidEd25519PublicKey(fixed.seller) &&
      StrKey.isValidEd25519PublicKey(fixed.buyer) &&
      fixed.seller !== fixed.buyer,
  );
  check(/^@[a-zA-Z0-9._]{3,30}$/.test(fixed.destination));
  check(/^[a-f0-9]{64}$/.test(fixed.recipientSalt) && !/^0+$/.test(fixed.recipientSalt));
  check(positiveAmount(fixed.tokenAmount) && positiveAmount(fixed.fiatMinor));
  const commitment = recipientCommitment({
    recipient_id: fixed.recipientId,
    recipient_salt: fixed.recipientSalt,
  }).toString('hex');
  const bindingRecord = () => {
    check(isTrustedTlsnReader(evidenceReader));
    const payment = normalizedVerifiedPayment(evidenceReader.readVerifiedRecord(fixed.evidenceId));
    check(
      payment.payerScope === fixed.payerScope && payment.recipientId === fixed.recipientId,
      'BANK_WALLET_BINDING_MISMATCH',
    );
  };
  bindingRecord();
  const db = new DatabaseSync(authorizationPath);
  chmodSync(authorizationPath, 0o600);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS live_authorizations (deployment TEXT NOT NULL, account TEXT NOT NULL, order_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, evidence_id TEXT NOT NULL, PRIMARY KEY(deployment,account,order_id));',
  );
  let closed = false;
  const assertDeployment = (cfg) => {
    check(
      !closed && cfg.policySignerPublicKeyHex === signer.publicKeyHex,
      'PAYMENT_SIGNER_MISMATCH',
    );
    check(
      cfg.token === fixed.token && cfg.network === fixed.network,
      'PAYMENT_DEPLOYMENT_MISMATCH',
    );
    bindingRecord();
  };
  const assertOrder = (cfg, order, account) => {
    assertDeployment(cfg);
    check(account === fixed.buyer && order.buyer === fixed.buyer, 'BUYER_WALLET_MISMATCH');
    check(
      order.terms.seller === fixed.seller &&
        order.terms.recipient === commitment &&
        positiveAmount(order.terms.token_amount) &&
        BigInt(order.terms.token_amount) <= BigInt(fixed.tokenAmount) &&
        positiveAmount(order.terms.fiat_minor) &&
        order.terms.currency === 'EUR' &&
        order.terms.rail === 'revolut',
      'ORDER_BINDING_MISMATCH',
    );
  };
  const support = Object.freeze({
    recipientCommitment: commitment,
    maximumOfferUSDC: usdcUnits(fixed.tokenAmount),
    canCreateOffer(account) {
      return !closed && account === fixed.seller;
    },
    createOfferTerms({ account, tokenAmount, fiatMinor, offerExpiresAt }) {
      check(!closed && account === fixed.seller, 'OFFER_CREATION_UNAVAILABLE');
      bindingRecord();
      check(positiveAmount(tokenAmount), 'INVALID_OFFER_AMOUNT');
      check(BigInt(tokenAmount) <= BigInt(fixed.tokenAmount), 'OFFER_AMOUNT_LIMIT');
      check(positiveAmount(fiatMinor), 'INVALID_OFFER_PRICE');
      check(
        typeof offerExpiresAt === 'string' &&
          /^[1-9][0-9]{0,19}$/.test(offerExpiresAt) &&
          BigInt(offerExpiresAt) < 1n << 64n &&
          BigInt(offerExpiresAt) > BigInt(clock()),
        'INVALID_OFFER_EXPIRY',
      );
      return {
        seller: fixed.seller,
        token_amount: tokenAmount,
        fiat_minor: fiatMinor,
        currency: 'EUR',
        rail: 'revolut',
        recipient: commitment,
        offer_expires_at: offerExpiresAt,
        reservation_seconds: '3600',
      };
    },
    assertBuyer(account) {
      check(account === fixed.buyer, 'BUYER_WALLET_MISMATCH');
    },
    async ready(cfg) {
      try {
        assertDeployment(cfg);
        return (await proofHealth()) === true;
      } catch {
        return false;
      }
    },
    async assertLock({ deployment, order, account }) {
      assertOrder(deployment, order, account);
      check(order.state === 'Reserved' || order.state === 'Paying', 'ORDER_NOT_RESERVED');
      check((await proofHealth()) === true);
    },
    offerReader: Object.freeze({
      async read({ recipientCommitment: expected }) {
        bindingRecord();
        check(expected === commitment, 'PRIVATE_OFFER_COMMITMENT_MISMATCH');
        return {
          seller: fixed.seller,
          buyer: fixed.buyer,
          recipientId: fixed.recipientId,
          recipientSalt: fixed.recipientSalt,
          payerScope: fixed.payerScope,
          destination: fixed.destination,
          sourceBindingVerified: true,
        };
      },
    }),
    async policyFor({ account, domain, network, token, deployment, ledgerReader, store }) {
      assertDeployment(deployment);
      // This constructor checks the real signing adapter and durable live store.
      const policy = createLivePaymentPolicy({
        domain,
        network,
        token,
        ledgerReader,
        verifierReader: evidenceReader,
        store,
        signer,
        clock,
        claimLifetimeSeconds: '300',
      });
      const find = (orderId) =>
        db
          .prepare(
            'SELECT * FROM live_authorizations WHERE deployment=? AND account=? AND order_id=?',
          )
          .get(deployment.deploymentId, account, orderId);
      const checkOrder = async (orderId) => {
        const value = await ledgerReader.readSnapshot({ orderId });
        assertOrder(deployment, value.order, account);
        check(value.order.state === 'Paying', 'ORDER_NOT_PAYING');
        return value.order;
      };
      async function accepted(orderId, evidenceId) {
        await checkOrder(orderId);
        const result = await policy.issue({ orderId, evidenceId });
        check(BigInt(result.claim.expires_at) > BigInt(clock()), 'POLICY_AUTHORIZATION_EXPIRED');
        return result;
      }
      return Object.freeze({
        async readStatus(orderId) {
          const order = await checkOrder(orderId);
          const previous = find(orderId);
          if (previous) {
            await accepted(orderId, previous.evidence_id);
            return { orderId, status: 'verified', authorization: previous.token };
          }
          const candidates = evidenceReader.findPaymentIds({
            payerScope: fixed.payerScope,
            recipientId: fixed.recipientId,
            amountMinor: order.terms.fiat_minor,
            currency: 'EUR',
            after: order.locked_at,
            before: order.pay_by,
          });
          if (!candidates.length) return { orderId, status: 'pending' };
          if (candidates.length !== 1) return { orderId, status: 'rejected' };
          await accepted(orderId, candidates[0]);
          db.prepare('INSERT OR IGNORE INTO live_authorizations VALUES (?,?,?,?,?)').run(
            deployment.deploymentId,
            account,
            orderId,
            randomBytes(32).toString('hex'),
            candidates[0],
          );
          const saved = find(orderId);
          check(saved.evidence_id === candidates[0], 'PAYMENT_AUTHORIZATION_CHANGED');
          return { orderId, status: 'verified', authorization: saved.token };
        },
        async readAuthorization({ orderId, authorization }) {
          const saved = find(orderId);
          check(saved && saved.token === authorization, 'PAYMENT_AUTHORIZATION_INVALID');
          return accepted(orderId, saved.evidence_id);
        },
      });
    },
    close() {
      if (closed) return;
      closed = true;
      instances.delete(support);
      db.close();
    },
  });
  instances.add(support);
  return support;
}
