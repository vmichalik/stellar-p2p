import { requirePolicy, exactKeys, uint, positiveAmount } from './errors.mjs';
import { normalizedVerifiedPayment } from './tlsn-store.mjs';

// Only an opaque record issued by the authenticated verifier store can normalize.
// Browser summaries, pasted JSON and arbitrary reader objects still fail closed.
export function normalizeLiveTlsnPayment(record) {
  return normalizedVerifiedPayment(record);
}

export function validateSyntheticPayment(payment) {
  exactKeys(
    payment,
    [
      'kind',
      'serverName',
      'method',
      'requestPath',
      'httpStatus',
      'rail',
      'currency',
      'amountUnit',
      'amountMinor',
      'state',
      'direction',
      'transactionType',
      'recipientId',
      'payerScope',
      'paymentId',
      'completedAt',
    ],
    'INVALID_EVIDENCE',
  );
  requirePolicy(payment.kind === 'SYNTHETIC_PAYMENT_FIXTURE_V1', 'SYNTHETIC_EVIDENCE_REQUIRED');
  requirePolicy(
    payment.serverName === 'app.revolut.com' &&
      payment.method === 'GET' &&
      payment.httpStatus === 200,
    'INVALID_PAYMENT_SOURCE',
  );
  // Synthetic semantics only; these are NOT alleged Revolut field names/enums.
  requirePolicy(
    payment.rail === 'revolut' && payment.currency === 'EUR' && payment.amountUnit === 'EUR_CENTS',
    'INVALID_PAYMENT_UNITS',
  );
  requirePolicy(
    payment.state === 'COMPLETED' &&
      payment.direction === 'OUTGOING' &&
      payment.transactionType === 'REVOLUT_TO_REVOLUT',
    'INVALID_PAYMENT_STATE',
  );
  positiveAmount(payment.amountMinor);
  uint(payment.completedAt);
  for (const key of ['recipientId', 'payerScope', 'paymentId']) {
    requirePolicy(
      typeof payment[key] === 'string' && /^[\x21-\x7e]{1,256}$/.test(payment[key]),
      'INVALID_PAYMENT_IDENTITY',
    );
  }
  requirePolicy(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payment.paymentId) &&
      payment.requestPath === `/api/retail/transaction/${payment.paymentId}`,
    'PAYMENT_IDENTITY_MISMATCH',
  );
  return structuredClone(payment);
}
