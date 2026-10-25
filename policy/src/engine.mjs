import { createHash } from 'node:crypto';
import { Address, StrKey, Keypair, Networks } from '@stellar/stellar-sdk';
import {
  claimDigest,
  networkId,
  recipientCommitment,
  paymentNullifier,
} from '../vendor/escrow-protocol.mjs';
import {
  PolicyError,
  requirePolicy,
  exactKeys,
  uint,
  positiveAmount,
  hex32,
  identifier,
} from './errors.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
export function escrowDomainKey(domain) {
  exactKeys(domain, ['network_passphrase', 'contract'], 'INVALID_DOMAIN');
  requirePolicy(
    [Networks.TESTNET, Networks.PUBLIC].includes(domain.network_passphrase) &&
      StrKey.isValidContract(domain.contract),
    'INVALID_DOMAIN',
  );
  return hash(
    Buffer.concat([networkId(domain.network_passphrase), new Address(domain.contract).toBuffer()]),
  );
}
export function orderBinding(domain, orderId) {
  uint(orderId);
  return hash(
    Buffer.concat([Buffer.from(escrowDomainKey(domain), 'hex'), Buffer.from(orderId, 'ascii')]),
  );
}

// Internal server engine. Package exports do not expose this dependency-injected
// constructor. Live and synthetic bootstrap paths use separate normalizers/keys.
export function makePolicy({
  domain,
  token,
  ledgerReader,
  loadEvidence,
  normalize,
  store,
  signer,
  syntheticOnly,
  clock = () => String(Math.floor(Date.now() / 1000)),
  claimLifetimeSeconds = '120',
  maxLedgerAgeSeconds = '60',
  manualResolutionReader,
}) {
  const frozenDomain = Object.freeze(structuredClone(domain));
  const domainKey = escrowDomainKey(frozenDomain);
  // Live callers pin the exact token contract independently of the ledger
  // adapter. Synthetic fixtures may retain their legacy snapshot-only setup.
  requirePolicy(
    (syntheticOnly === true && token === undefined) || StrKey.isValidContract(token),
    'INVALID_TOKEN',
  );
  requirePolicy(
    store?.syntheticOnly === syntheticOnly && signer?.syntheticOnly === syntheticOnly,
    'ADAPTER_MODE_MISMATCH',
  );
  const ttl = uint(claimLifetimeSeconds);
  const maxAge = uint(maxLedgerAgeSeconds);
  requirePolicy(ttl > 0n && ttl <= 300n && maxAge > 0n && maxAge <= 300n, 'INVALID_POLICY_WINDOW');
  requirePolicy(
    typeof ledgerReader?.readOrder === 'function' && typeof loadEvidence === 'function',
    'ADAPTER_REQUIRED',
  );

  async function boundary(fn) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof PolicyError) throw error;
      throw new PolicyError('POLICY_ADAPTER_FAILED');
    }
  }
  async function payment(evidenceId) {
    identifier(evidenceId);
    // Only an identifier crosses the caller boundary. The caller supplies no
    // evidence, verified flag, amount, order snapshot, claim or digest.
    return normalize(await loadEvidence(evidenceId));
  }
  async function snapshot(orderId, nullifier = null) {
    uint(orderId);
    const result = structuredClone(
      await ledgerReader.readOrder({ domain: frozenDomain, orderId, nullifier }),
    );
    const now = uint(clock());
    requirePolicy(
      result?.confirmed === true &&
        result.network_passphrase === frozenDomain.network_passphrase &&
        result.contract === frozenDomain.contract &&
        result.order?.id === orderId,
      'UNTRUSTED_ORDER_SNAPSHOT',
    );
    const ledgerTime = uint(result.ledgerTimestamp);
    uint(result.ledgerSequence);
    requirePolicy(ledgerTime <= now && now - ledgerTime <= maxAge, 'STALE_LEDGER_SNAPSHOT');
    requirePolicy(result.config?.signer === signer.publicKeyHex, 'SIGNER_CONFIG_MISMATCH');
    requirePolicy(StrKey.isValidContract(result.config.token), 'INVALID_TOKEN');
    requirePolicy(token === undefined || result.config.token === token, 'TOKEN_CONFIG_MISMATCH');
    return { result, now, ledgerTime };
  }
  function recipient(payment, result) {
    const terms = result.order.terms;
    // Private salt comes from the server's authorized offer-data store, never
    // caller input. Recompute using verified identity and canonical protocol.
    const commitment = recipientCommitment({
      recipient_id: payment.recipientId,
      recipient_salt: result.offerData.recipientSalt,
    }).toString('hex');
    requirePolicy(commitment === hex32(terms.recipient), 'RECIPIENT_MISMATCH');
    return commitment;
  }
  function checkPayment(payment, result, ledgerTime) {
    const { order } = result;
    requirePolicy(order.state === 'Paying', 'ORDER_NOT_PAYING');
    if (!syntheticOnly) {
      requirePolicy(
        typeof result.offerData?.payerScope === 'string' &&
          result.offerData.payerScope === payment.payerScope,
        'PAYER_BINDING_UNVERIFIED',
      );
    }
    requirePolicy(
      payment.rail === order.terms.rail &&
        payment.currency === order.terms.currency &&
        payment.rail === 'revolut' &&
        payment.currency === 'EUR',
      'ORDER_CURRENCY_MISMATCH',
    );
    requirePolicy(
      positiveAmount(payment.amountMinor) === positiveAmount(order.terms.fiat_minor),
      'AMOUNT_MISMATCH',
    );
    positiveAmount(order.terms.token_amount);
    const lock = uint(order.locked_at),
      reserved = uint(order.reserved_at),
      deadline = uint(order.pay_by),
      paid = uint(payment.completedAt);
    requirePolicy(
      reserved <= lock && lock < deadline && deadline <= uint(order.terms.offer_expires_at),
      'INVALID_ORDER_WINDOW',
    );
    requirePolicy(paid >= lock && paid < deadline && paid <= ledgerTime, 'PAYMENT_OUTSIDE_WINDOW');
    requirePolicy(
      order.buyer !== order.terms.seller &&
        (StrKey.isValidEd25519PublicKey(order.buyer) || StrKey.isValidContract(order.buyer)),
      'INVALID_BUYER',
    );
    recipient(payment, result);
  }
  return Object.freeze({
    syntheticOnly,
    async issue(input) {
      return boundary(async () => {
        exactKeys(input, ['orderId', 'evidenceId']);
        const verified = await payment(input.evidenceId);
        const nullifier = paymentNullifier({
          payer_scope: verified.payerScope,
          payment_id: verified.paymentId,
        }).toString('hex');
        const { result, now, ledgerTime } = await snapshot(input.orderId, nullifier);
        checkPayment(verified, result, ledgerTime);
        requirePolicy(result.paymentUsed === false, 'PAYMENT_CONSUMED_ON_CHAIN');
        store.assertReconciled(domainKey, result.ledgerSequence);
        const { order, config } = result;
        const claim = {
          buyer: order.buyer,
          currency: order.terms.currency,
          expires_at: (now + ttl).toString(),
          fiat_minor: order.terms.fiat_minor,
          nullifier,
          order_id: input.orderId,
          paid_at: verified.completedAt,
          pay_by: order.pay_by,
          rail: order.terms.rail,
          recipient: order.terms.recipient,
          reserved_at: order.reserved_at,
          seller: order.terms.seller,
          token: config.token,
          token_amount: order.terms.token_amount,
        };
        const binding = orderBinding(frozenDomain, input.orderId);
        const digest = claimDigest({ ...frozenDomain, claim }).toString('hex');
        // Durable reservation happens before contacting any signing adapter.
        const record = store.reserve({ nullifier, binding, claim, digest, now });
        const canonical = claimDigest({ ...frozenDomain, claim: record.claim });
        requirePolicy(canonical.toString('hex') === record.digest, 'STORED_CLAIM_MISMATCH');
        requirePolicy(
          claimDigest({
            ...frozenDomain,
            claim: { ...claim, expires_at: record.claim.expires_at },
          }).equals(canonical),
          'ORDER_TERMS_CHANGED',
        );
        let signature = record.signature
          ? Buffer.from(record.signature, 'hex')
          : await signer.signDigest(Buffer.from(canonical));
        requirePolicy(
          signature instanceof Uint8Array && signature.length === 64,
          'INVALID_POLICY_SIGNATURE',
        );
        signature = Buffer.from(signature);
        requirePolicy(
          Keypair.fromPublicKey(
            StrKey.encodeEd25519PublicKey(Buffer.from(signer.publicKeyHex, 'hex')),
          ).verify(canonical, signature),
          'INVALID_POLICY_SIGNATURE',
        );
        store.complete(nullifier, record.digest, signature.toString('hex'));
        return {
          kind: syntheticOnly
            ? 'SYNTHETIC_POLICY_CLAIM_NOT_FOR_RELEASE'
            : 'VERIFIED_POLICY_CLAIM_V1',
          syntheticOnly,
          releaseGate: syntheticOnly ? 'NOT_CLEARED' : 'POLICY_ACCEPTED',
          domain: structuredClone(frozenDomain),
          claim: structuredClone(record.claim),
          digestHex: record.digest,
          signatureHex: signature.toString('hex'),
          signerPublicKeyHex: signer.publicKeyHex,
        };
      });
    },
    async reconcileRelease(input) {
      return boundary(async () => {
        exactKeys(input, ['orderId', 'evidenceId']);
        const verified = await payment(input.evidenceId);
        const nullifier = paymentNullifier({
          payer_scope: verified.payerScope,
          payment_id: verified.paymentId,
        }).toString('hex');
        const { result } = await snapshot(input.orderId, nullifier);
        requirePolicy(
          result.order.state === 'Released' && result.paymentUsed === true,
          'RELEASE_NOT_CONFIRMED',
        );
        store.markReleased(nullifier, orderBinding(frozenDomain, input.orderId));
        return { status: 'RELEASE_CONFIRMED', syntheticOnly };
      });
    },
    async beginManualReconciliation(input) {
      return boundary(async () => {
        exactKeys(input, ['orderId']);
        const { result } = await snapshot(input.orderId);
        requirePolicy(
          ['Paying', 'Reserved', 'Resolved'].includes(result.order.state),
          'INVALID_RECOVERY_STATE',
        );
        store.holdManualResolution(orderBinding(frozenDomain, input.orderId));
        return { status: 'MANUAL_RECONCILIATION_REQUIRED', releaseGate: 'NOT_CLEARED' };
      });
    },
    async reconcileManualResolution(input) {
      return boundary(async () => {
        exactKeys(input, ['resolutionId']);
        identifier(input.resolutionId);
        requirePolicy(
          typeof manualResolutionReader?.readConfirmedManifest === 'function',
          'MANUAL_RECONCILIATION_UNAVAILABLE',
        );
        // Only a trusted server recovery reader can attest a COMPLETE manifest.
        // An on-chain Resolved event alone does not identify fiat payments.
        const manifest = await manualResolutionReader.readConfirmedManifest(input.resolutionId);
        requirePolicy(
          manifest?.complete === true &&
            manifest.confirmed === true &&
            Array.isArray(manifest.evidenceIds) &&
            manifest.evidenceIds.length > 0 &&
            manifest.evidenceIds.length <= 100,
          'MANUAL_PAYMENT_IDENTITY_REQUIRED',
        );
        const { result } = await snapshot(manifest.orderId);
        requirePolicy(result.order.state === 'Resolved', 'MANUAL_RESOLUTION_NOT_CONFIRMED');
        const nullifiers = [];
        for (const evidenceId of manifest.evidenceIds) {
          const verified = await payment(evidenceId);
          recipient(verified, result);
          nullifiers.push(
            paymentNullifier({
              payer_scope: verified.payerScope,
              payment_id: verified.paymentId,
            }).toString('hex'),
          );
        }
        store.completeManualResolution(orderBinding(frozenDomain, manifest.orderId), nullifiers);
        return { status: 'MANUAL_PAYMENTS_CONSUMED', syntheticOnly, releaseGate: 'NOT_CLEARED' };
      });
    },
  });
}
