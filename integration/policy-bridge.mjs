// Local test bridge only. This module has no RPC, bank, HTTP or wallet client.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, transition } from '../app/model.mjs';
import { ReplayStore, escrowDomainKey, recipientCommitment } from '../policy/src/index.mjs';
import { createSyntheticPaymentPolicy, SYNTHETIC_PUBLIC_KEY_HEX } from '../policy/src/testing.mjs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const phase = process.argv[2];
const paymentId = '00000000-0000-4000-8000-000000000001';
const recipientSalt = '33'.repeat(32);
const recipient = recipientCommitment({
  recipient_id: 'synthetic-recipient',
  recipient_salt: recipientSalt,
}).toString('hex');
const uiId = 'PCT-LOCAL-WASM-001';

function payment() {
  return {
    kind: 'SYNTHETIC_PAYMENT_FIXTURE_V1',
    serverName: 'app.revolut.com',
    method: 'GET',
    requestPath: `/api/retail/transaction/${paymentId}`,
    httpStatus: 200,
    rail: 'revolut',
    currency: 'EUR',
    amountUnit: 'EUR_CENTS',
    amountMinor: '2000',
    state: 'COMPLETED',
    direction: 'OUTGOING',
    transactionType: 'REVOLUT_TO_REVOLUT',
    recipientId: 'synthetic-recipient',
    payerScope: 'synthetic-payer-account',
    paymentId,
    completedAt: '1001',
  };
}

function policy(snapshot, store) {
  return createSyntheticPaymentPolicy({
    domain: input.domain,
    store,
    snapshots: { [snapshot.order.id]: snapshot },
    evidence: { e1: payment() },
    clock: () => '2000',
  });
}

let output;
if (phase === 'prepare') {
  let state = initialState();
  for (const event of [
    { type: 'seller_connect' },
    { type: 'seller_create', amount: '22', tag: '@synthetic.seller' },
    { type: 'seller_fund_started' },
    { type: 'connect' },
  ])
    state = transition(state, { ...event, now: 1_000_000 });
  output = {
    uiState: state,
    recipientSalt,
    recipient,
    signerPublicKeyHex: SYNTHETIC_PUBLIC_KEY_HEX,
    tokenAtoms: String(state.seller.offerAtoms),
    fiatMinor: String(state.offers[0].maxMinor),
  };
} else if (phase === 'issue') {
  let state = input.uiState;
  for (const event of [
    { type: 'seller_fund_confirmed', id: uiId },
    { type: 'reserve', offerId: 'ben', id: uiId, amount: '20' },
  ])
    state = transition(state, { ...event, now: 1_000_000 });
  assert.equal(state.orders[0].status, 'reserved');
  assert.equal(state.orders[0].lockedAt, undefined);
  state = transition(state, { type: 'payment_lock_started', orderId: uiId, now: 1_000_000 });
  // The Rust driver has already confirmed the real WASM begin_payment call.
  assert.equal(input.snapshot.order.state, 'Paying');
  state = transition(state, {
    type: 'payment_lock_confirmed',
    orderId: uiId,
    now: Number(input.snapshot.order.locked_at) * 1000,
  });
  state = transition(state, { type: 'payment_reported', orderId: uiId, now: 2_000_000 });
  state = transition(state, { type: 'verify_started', orderId: uiId, now: 2_000_000 });
  state = transition(state, {
    type: 'verify_failed',
    orderId: uiId,
    reason: 'unavailable',
    now: 2_000_000,
  });
  assert.equal(state.balanceAtoms, 0);
  assert.equal(state.seller.returnedAtoms, 0);
  state = transition(state, { type: 'verify_started', orderId: uiId, now: 2_000_000 });
  const store = new ReplayStore(input.storePath, { syntheticOnly: true });
  try {
    store.advanceCheckpoint(escrowDomainKey(input.domain), input.snapshot.ledgerSequence);
    const signed = await policy(input.snapshot, store).issue({
      orderId: input.snapshot.order.id,
      evidenceId: 'e1',
    });
    assert.equal(signed.syntheticOnly, true);
    state = transition(state, { type: 'verify_succeeded', orderId: uiId, now: 2_000_000 });
    output = { signed, uiState: state };
  } finally {
    store.close();
  }
} else if (phase === 'complete') {
  const released = structuredClone(input.snapshot);
  released.order.state = 'Released';
  released.paymentUsed = true;
  const store = new ReplayStore(input.storePath, { syntheticOnly: true });
  try {
    await policy(released, store).reconcileRelease({
      orderId: released.order.id,
      evidenceId: 'e1',
    });
    const secondOrder = structuredClone(input.snapshot);
    secondOrder.order.id = String(BigInt(secondOrder.order.id) + 1n);
    await assert.rejects(
      policy(secondOrder, store).issue({ orderId: secondOrder.order.id, evidenceId: 'e1' }),
      { code: 'PAYMENT_ALREADY_BOUND' },
    );
  } finally {
    store.close();
  }
  assert.deepEqual(input.balances, { buyer: '220000000', seller: '0', escrow: '0' });
  let state = transition(input.issued.uiState, {
    type: 'settle_started',
    orderId: uiId,
    now: 2_000_000,
  });
  state = transition(state, { type: 'settlement_confirmed', orderId: uiId, now: 2_000_000 });
  assert.equal(String(state.balanceAtoms), input.balances.buyer);
  assert.equal(state.seller.receivedFiatMinor, 2000);
  assert.throws(() => transition(state, { type: 'settle_started', orderId: uiId }));
  output = {
    kind: 'LOCAL_WASM_INTEGRATION_REHEARSAL',
    paymentEvidence: 'synthetic',
    networkTransactionsSubmitted: false,
    contractExecution: 'compiled Soroban WASM in local host',
    uiStatus: state.orders[0].status,
    buyerAtoms: String(state.balanceAtoms),
    balances: input.balances,
    fiatMinor: '2000',
    canonicalDigest: input.issued.signed.digestHex,
    signatureCheckedByWasm: true,
    paymentLockConfirmedBeforeInstructions: true,
    proofFailureHeldFunds: true,
    lateTimelyPaymentAccepted: true,
    contractReplayRejected: true,
    policyReplayRejected: true,
    duplicateUiSettlementRejected: true,
    livePaymentGate: 'NOT_CLEARED',
    transactionHash: null,
  };
} else {
  throw new Error('Unknown local rehearsal phase');
}
process.stdout.write(JSON.stringify(output));
