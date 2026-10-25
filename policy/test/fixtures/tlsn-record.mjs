// Sanitized synthetic values only. This fixture performs no TLS cryptography.
export const ids = [1, 2, 3, 4, 5, 6].map(
  (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
);
export const now = Date.UTC(2026, 0, 1, 12);
export function transaction() {
  return {
    id: ids[0],
    groupKey: ids[0],
    legId: ids[1],
    registeredIdentityId: ids[2],
    account: { id: ids[3], type: 'CURRENT' },
    recipient: {
      id: ids[4],
      identityId: ids[4],
      type: 'INDIVIDUAL',
      individualType: 'PERSONAL',
      account: { id: ids[5], type: 'CURRENT' },
      code: 'synthetic-code',
      firstName: 'NOT_PERSISTED',
    },
    amount: -123,
    amountWithCharges: -123,
    fee: 0,
    currency: 'EUR',
    state: 'COMPLETED',
    type: 'TRANSFER',
    tag: 'transfers',
    transferAppSource: 'USERNAME',
    startedDate: now - 2000,
    completedDate: now - 1000,
    balance: 987654321,
  };
}
export const range = (type, start, end, kind = 'REVEAL') => ({
  start,
  end,
  handler: { type, part: 'ALL', action: { kind } },
});
export function payload({ payment = transaction(), json, chunked = false, headers = '' } = {}) {
  const body = Buffer.from(json ?? JSON.stringify([payment]));
  const sent = `GET /api/retail/transaction/${ids[0]} HTTP/1.1\r\nHost: app.revolut.com\r\n`;
  const recv =
    `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nDate: ${new Date(now).toUTCString()}\r\nSet-Cookie: synthetic=NOT_PERSISTED\r\n${headers}` +
    (chunked ? 'Transfer-Encoding: chunked' : `Content-Length: ${body.length}`) +
    '\r\n\r\n' +
    (chunked ? `${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n` : body.toString());
  return {
    server_name: 'app.revolut.com',
    session: { id: 'synthetic-session' },
    results: [],
    transcript: {
      sent,
      recv,
      sent_length: Buffer.byteLength(sent),
      recv_length: Buffer.byteLength(recv),
    },
    config: {
      sent: [range('SENT', 0, Buffer.byteLength(sent))],
      recv: [range('RECV', 0, Buffer.byteLength(recv))],
    },
  };
}
