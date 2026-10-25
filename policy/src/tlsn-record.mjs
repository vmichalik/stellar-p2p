import { requirePolicy } from './errors.mjs';

const check = (ok, code = 'INVALID_TLSN_RECORD') => requirePolicy(ok, code);
const uuid = (s) =>
  typeof s === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const object = (s) => s !== null && typeof s === 'object' && !Array.isArray(s);

// JSON.parse alone silently accepts duplicate keys. Check every object before
// interpreting authenticated financial data, including escaped duplicate names.
function uniqueJson(source) {
  let at = 0;
  const space = () => {
    while (/[\t\r\n ]/.test(source[at] ?? 'x')) at++;
  };
  function string() {
    check(source[at] === '"', 'INVALID_PAYMENT_JSON');
    const start = at++;
    while (at < source.length) {
      const c = source[at++];
      if (c === '\\') {
        at++;
        continue;
      }
      if (c === '"') {
        try {
          return JSON.parse(source.slice(start, at));
        } catch {
          check(false, 'INVALID_PAYMENT_JSON');
        }
      }
    }
    check(false, 'INVALID_PAYMENT_JSON');
  }
  function value(depth) {
    check(depth < 32, 'INVALID_PAYMENT_JSON');
    space();
    if (source[at] === '"') {
      string();
      return;
    }
    if (source[at] === '{' || source[at] === '[') {
      const isObject = source[at++] === '{',
        end = isObject ? '}' : ']';
      const names = new Set();
      space();
      if (source[at] === end) {
        at++;
        return;
      }
      while (at < source.length) {
        if (isObject) {
          space();
          const name = string();
          check(!names.has(name), 'DUPLICATE_PAYMENT_KEY');
          names.add(name);
          space();
          check(source[at++] === ':', 'INVALID_PAYMENT_JSON');
        }
        value(depth + 1);
        space();
        if (source[at] === end) {
          at++;
          return;
        }
        check(source[at++] === ',', 'INVALID_PAYMENT_JSON');
      }
      check(false, 'INVALID_PAYMENT_JSON');
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
      source.slice(at),
    );
    check(token, 'INVALID_PAYMENT_JSON');
    at += token[0].length;
  }
  value(0);
  space();
  check(at === source.length, 'INVALID_PAYMENT_JSON');
  try {
    return JSON.parse(source);
  } catch {
    check(false, 'INVALID_PAYMENT_JSON');
  }
}

function covered(ranges, length, direction) {
  check(Array.isArray(ranges) && ranges.length > 0 && ranges.length <= 128);
  const spans = ranges
    .map((r) => {
      check(
        Number.isSafeInteger(r.start) &&
          Number.isSafeInteger(r.end) &&
          r.start >= 0 &&
          r.end > r.start &&
          r.end <= length &&
          r.handler?.type === direction,
      );
      // Hash commitments and user-supplied handler labels cannot supply plaintext.
      check(r.handler?.action?.kind === 'REVEAL', 'PLAINTEXT_DISCLOSURE_REQUIRED');
      return [r.start, r.end];
    })
    .sort((a, b) => a[0] - b[0]);
  return (end, begin = 0) => {
    let cursor = begin;
    for (const [start, stop] of spans) {
      if (stop <= cursor) continue;
      if (start > cursor) return false;
      cursor = Math.max(cursor, stop);
      if (cursor >= end) return true;
    }
    return false;
  };
}

function httpResponse(bytes) {
  const boundary = bytes.indexOf('\r\n\r\n');
  check(boundary > 0 && boundary < 12288, 'INVALID_PAYMENT_HTTP');
  const lines = bytes.subarray(0, boundary).toString('latin1').split('\r\n');
  check(/^HTTP\/1\.[01] 200(?: [\x20-\x7e]*)?$/.test(lines.shift()), 'PAYMENT_HTTP_STATUS');
  const headers = new Map();
  for (const line of lines) {
    const match = /^([!#$%&'*+.^_`|~0-9a-zA-Z-]+):[\t ]*([\t\x20-\x7e]*)$/.exec(line);
    check(match, 'INVALID_PAYMENT_HTTP');
    const name = match[1].toLowerCase(),
      value = match[2].trim();
    check(name === 'set-cookie' || !headers.has(name), 'AMBIGUOUS_PAYMENT_HTTP');
    headers.set(name, value);
  }
  check(
    /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers.get('content-type') ?? ''),
    'PAYMENT_CONTENT_TYPE',
  );
  check(
    !headers.has('content-encoding') ||
      headers.get('content-encoding').toLowerCase() === 'identity',
    'PAYMENT_ENCODING_UNSUPPORTED',
  );
  const data = bytes.subarray(boundary + 4);
  let body;
  if (headers.has('transfer-encoding')) {
    check(
      !headers.has('content-length') &&
        headers.get('transfer-encoding').toLowerCase() === 'chunked',
      'AMBIGUOUS_PAYMENT_HTTP',
    );
    const chunks = [];
    let at = 0;
    while (at < data.length) {
      const line = data.indexOf('\r\n', at);
      check(line > at && line - at <= 8, 'INVALID_PAYMENT_FRAMING');
      const size = data.subarray(at, line).toString('latin1');
      check(/^[a-f0-9]+$/i.test(size), 'INVALID_PAYMENT_FRAMING');
      const count = parseInt(size, 16);
      at = line + 2;
      check(
        count <= 16384 &&
          at + count + 2 <= data.length &&
          data.subarray(at + count, at + count + 2).equals(Buffer.from('\r\n')),
        'INVALID_PAYMENT_FRAMING',
      );
      if (!count) {
        check(at + 2 === data.length, 'PAYMENT_TRAILERS_UNSUPPORTED');
        break;
      }
      chunks.push(data.subarray(at, at + count));
      at += count + 2;
    }
    check(
      at + 2 === data.length && data.subarray(at).equals(Buffer.from('\r\n')),
      'INVALID_PAYMENT_FRAMING',
    );
    body = Buffer.concat(chunks);
  } else {
    check(
      /^(0|[1-9][0-9]{0,4})$/.test(headers.get('content-length') ?? ''),
      'PAYMENT_FRAMING_REQUIRED',
    );
    check(Number(headers.get('content-length')) === data.length, 'INVALID_PAYMENT_FRAMING');
    body = data;
  }
  const date = Date.parse(headers.get('date') ?? '');
  check(Number.isSafeInteger(date), 'PAYMENT_RESPONSE_DATE_REQUIRED');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    check(false, 'INVALID_PAYMENT_JSON');
  }
  return { json: uniqueJson(text), date };
}

// This decoder must only be called by the authenticated verifier ingress. It
// deliberately ignores results, params, labels, order IDs and session metadata.
// Full authenticated response bytes establish framing and JSON record context.
export function decodeVerifierPayment(payload, receivedAt) {
  check(payload?.server_name === 'app.revolut.com', 'INVALID_PAYMENT_SOURCE');
  check(Number.isSafeInteger(receivedAt) && receivedAt > 0);
  const t = payload.transcript;
  check(object(t));
  check(Number.isSafeInteger(t.sent_length) && t.sent_length > 0 && t.sent_length <= 4096);
  check(Number.isSafeInteger(t.recv_length) && t.recv_length > 0 && t.recv_length <= 16384);
  check(
    typeof t.sent === 'string' &&
      typeof t.recv === 'string' &&
      !t.recv.includes('\u0000') &&
      !t.recv.includes('\ufffd'),
    'FULL_RESPONSE_REQUIRED',
  );
  check(
    Buffer.byteLength(t.sent) === t.sent_length && Buffer.byteLength(t.recv) === t.recv_length,
    'TRANSCRIPT_LENGTH_MISMATCH',
  );
  const sent = Buffer.from(t.sent),
    recv = Buffer.from(t.recv);
  const requestEnd = sent.indexOf('\r\n') + 2;
  check(
    requestEnd > 2 && covered(payload.config?.sent, t.sent_length, 'SENT')(requestEnd),
    'REQUEST_LINE_UNAUTHENTICATED',
  );
  check(
    covered(payload.config?.recv, t.recv_length, 'RECV')(t.recv_length),
    'FULL_RESPONSE_REQUIRED',
  );
  const request = /^GET (\/api\/retail\/transaction\/([a-f0-9-]{36})) HTTP\/1\.1\r\n$/.exec(
    sent.subarray(0, requestEnd).toString('latin1'),
  );
  check(request && uuid(request[2]), 'INVALID_PAYMENT_SOURCE');
  const hostLines = [
    ...sent.toString('latin1').matchAll(/(?:^|\r\n)(host:[\t ]*([^\r\n\0]+)\r\n)/gi),
  ];
  check(
    hostLines.length === 1 && hostLines[0][2].trim().toLowerCase() === 'app.revolut.com',
    'PAYMENT_HOST_REQUIRED',
  );
  const hostStart = hostLines[0].index + hostLines[0][0].length - hostLines[0][1].length;
  check(
    covered(
      payload.config.sent,
      t.sent_length,
      'SENT',
    )(hostStart + Buffer.byteLength(hostLines[0][1]), hostStart),
    'PAYMENT_HOST_UNAUTHENTICATED',
  );
  const { json, date } = httpResponse(recv);
  check(Math.abs(date - receivedAt) <= 300000, 'STALE_VERIFIER_RESPONSE');
  check(Array.isArray(json) && json.length === 1 && object(json[0]), 'UNSUPPORTED_PAYMENT_RECORD');
  const p = json[0],
    r = p.recipient;
  check(
    uuid(p.id) && p.id === request[2] && p.groupKey === p.id && uuid(p.legId),
    'PAYMENT_IDENTITY_MISMATCH',
  );
  check(
    p.currency === 'EUR' && Number.isSafeInteger(p.amount) && p.amount < 0,
    'INVALID_PAYMENT_UNITS',
  );
  check(
    p.state === 'COMPLETED' &&
      p.type === 'TRANSFER' &&
      p.tag === 'transfers' &&
      p.transferAppSource === 'USERNAME',
    'INVALID_PAYMENT_STATE',
  );
  check(p.fee === 0 && p.amountWithCharges === p.amount, 'PAYMENT_CHARGES_UNSUPPORTED');
  check(
    uuid(p.registeredIdentityId) && uuid(p.account?.id) && p.account.type === 'CURRENT',
    'INVALID_PAYER_IDENTITY',
  );
  check(
    object(r) &&
      uuid(r.identityId) &&
      r.id === r.identityId &&
      r.type === 'INDIVIDUAL' &&
      r.individualType === 'PERSONAL' &&
      uuid(r.account?.id) &&
      r.account.type === 'CURRENT',
    'INVALID_RECIPIENT_IDENTITY',
  );
  check(
    p.registeredIdentityId !== r.identityId && p.account.id !== r.account.id,
    'SELF_TRANSFER_UNSUPPORTED',
  );
  check(
    Number.isSafeInteger(p.completedDate) &&
      Number.isSafeInteger(p.startedDate) &&
      p.startedDate > 0 &&
      p.startedDate <= p.completedDate &&
      p.completedDate <= date + 1000 &&
      p.completedDate <= receivedAt,
    'INVALID_PAYMENT_TIME',
  );
  return {
    kind: 'VERIFIED_REVOLUT_PAYMENT_V1',
    serverName: 'app.revolut.com',
    method: 'GET',
    requestPath: request[1],
    httpStatus: 200,
    rail: 'revolut',
    currency: 'EUR',
    amountUnit: 'EUR_CENTS',
    amountMinor: (-BigInt(p.amount)).toString(),
    state: 'COMPLETED',
    direction: 'OUTGOING',
    transactionType: 'REVOLUT_TO_REVOLUT',
    recipientId: `revolut:identity:${r.identityId}`,
    // One identity scope across the payer's pockets avoids a new nullifier when
    // the same payment is presented through another sending-account view.
    payerScope: `revolut:identity:${p.registeredIdentityId}`,
    paymentId: p.id,
    completedAt: (BigInt(p.completedDate) / 1000n).toString(),
  };
}
