// Draft TLSNotary plugin. Configure only a verifier you have chosen and reviewed.
// Exact release source supports the wildcard and numeric JSON paths below.
// A live replay reached the bank response; required payment fields remain unverified.
const VERIFIER_ORIGIN = '';
const PROXY_URL = '';
// The response-check renderer sets this to true; explicit payment modes then fail closed.
const RESPONSE_SHAPE_ONLY = false;
const FULL_PAYMENT_RECORD = false;
const DETAIL_URL =
  /^https:\/\/app\.revolut\.com\/api\/retail\/transaction\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = [
  '0.amount',
  '0.currency',
  '0.recipient.code',
  '0.id',
  '0.state',
  '0.completedDate',
  '0.type',
];
const SHAPE_KEYS = [
  'amount',
  'currency',
  'recipient',
  'code',
  'id',
  'state',
  'completedDate',
  'type',
  'data',
  'error',
  'errors',
  'message',
  'status',
  'transactions',
  'transaction',
];
const ROOT_REGEX = '\\r\\n\\r\\n(?:[0-9a-fA-F]+\\r\\n)?\\s*(\\[|\\{)';
const KEYS_REGEX = '"(?:' + SHAPE_KEYS.join('|') + ')"\\s*:';
// 16KB sent/32KB received reproducibly exhausts the pinned MPC stream limit.
// Keep the upstream working budget and reject oversized requests before proof setup.
const MAX_SENT_DATA = 4096;
const MAX_RECV_DATA = 16384;
const config = {
  name: RESPONSE_SHAPE_ONLY ? 'Pactlane · Response check' : 'Pactlane · Transfer proof',
  description: RESPONSE_SHAPE_ONLY
    ? 'Inspect HTTP status and JSON structure for one existing transfer. No payment-field disclosure.'
    : 'Check one existing transfer. This test does not move money.',
  urls: ['https://app.revolut.com/*'],
  requests: [
    {
      method: 'GET',
      host: 'app.revolut.com',
      pathname: '/api/retail/transaction/*',
      verifierUrl: VERIFIER_ORIGIN,
    },
  ],
};

function isDetail(request) {
  return request && request.method === 'GET' && DETAIL_URL.test(request.url);
}

function main() {
  useEffect(() => {
    openWindow('https://app.revolut.com/start');
  }, []);
  const pending = useState('pending', false);
  // The pinned QuickJS host allocates callbacks when serializing hook values.
  // Avoid repeatedly copying captured headers while an explicit proof is pending.
  // Keep a non-null DOM result so the host can append its disclosure-approval UI.
  if (pending) {
    return div(
      {
        style: {
          position: 'fixed',
          bottom: '12px',
          right: '12px',
          width: '300px',
          zIndex: '2147483647',
          backgroundColor: '#fffefa',
          color: '#2d382e',
          padding: '20px',
          borderRadius: '18px',
          border: '1px solid #dedfd2',
          maxWidth: 'calc(100vw - 24px)',
          fontFamily: 'Manrope, Avenir Next, Avenir, system-ui, sans-serif',
          fontSize: '13px',
          lineHeight: '1.6',
        },
      },
      ['Proof in progress. Review the TLSNotary disclosure prompt when it appears.'],
    );
  }
  const [latest] = useHeaders((headers) =>
    headers
      .filter(isDetail)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 1),
  );
  // Header values stay inside the extension runtime and are never rendered.
  useEffect(() => {
    setState('selected', latest || null);
  }, [latest]);
  const message = useState(
    'message',
    RESPONSE_SHAPE_ONLY
      ? 'Open one existing transfer, then click Check response only.'
      : 'Open one existing transfer, then click Generate proof.',
  );
  return div(
    {
      style: {
        position: 'fixed',
        bottom: '12px',
        right: '12px',
        width: '300px',
        zIndex: '2147483647',
        backgroundColor: '#fffefa',
        color: '#2d382e',
        padding: '20px',
        borderRadius: '18px',
        border: '1px solid #dedfd2',
        maxWidth: 'calc(100vw - 24px)',
        boxShadow: '0 7px 24px #38422a18',
        fontFamily: 'Manrope, Avenir Next, Avenir, system-ui, sans-serif',
        fontSize: '13px',
        lineHeight: '1.6',
      },
    },
    [
      div({ style: { fontWeight: '700', marginBottom: '8px' } }, ['Pactlane · Transfer proof']),
      div({}, [
        latest
          ? 'Transfer found. Review it before generating a proof.'
          : 'Open an existing transfer to continue.',
      ]),
      div({}, [message]),
      latest && !pending && !RESPONSE_SHAPE_ONLY
        ? button(
            {
              onclick: 'generateProof',
              style: {
                backgroundColor: '#ed7047',
                color: '#2f281b',
                border: '1px solid #ed7047',
                borderRadius: '10px',
                padding: '12px 14px',
                minHeight: '44px',
                width: '100%',
                marginTop: '14px',
                fontFamily: 'inherit',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
              },
            },
            [
              FULL_PAYMENT_RECORD
                ? 'Prove the complete transfer record'
                : 'Generate proof for the last opened transfer',
            ],
          )
        : div({}, [pending ? 'Generating proof…' : 'No proof has started.']),
      latest && !pending
        ? button(
            {
              onclick: 'checkResponse',
              style: {
                backgroundColor: '#fffefa',
                color: '#2d382e',
                border: '1px solid #dedfd2',
                borderRadius: '10px',
                padding: '12px 14px',
                minHeight: '44px',
                width: '100%',
                marginTop: '14px',
                fontFamily: 'inherit',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
              },
            },
            ['Check response only'],
          )
        : div({}, []),
      div({ style: { marginTop: '8px', fontSize: '12px' } }, [
        RESPONSE_SHAPE_ONLY
          ? 'Response check shares HTTP metadata, JSON root type and selected field names.'
          : FULL_PAYMENT_RECORD
            ? 'This proof shares the complete response, including balance, identities, names and response headers. Review every disclosed field before approving.'
            : 'Generate proof shares amount, currency, recipient code, transaction ID, state, completion time and type. Review these values before approving.',
      ]),
    ],
  );
}

async function checkResponse() {
  return generateProof('response-shape');
}

async function generateProof(
  mode = RESPONSE_SHAPE_ONLY
    ? 'response-shape'
    : FULL_PAYMENT_RECORD
      ? 'payment-record'
      : 'payment-fields',
) {
  if (RESPONSE_SHAPE_ONLY && mode !== 'response-shape') {
    setState(
      'message',
      'Only the approved response-shape check is available here. No proof was requested.',
    );
    return;
  }
  if (mode === 'payment-record' && !FULL_PAYMENT_RECORD) return;
  if (useState('pending', false)) return;
  const selected = useState('selected', null);
  if (!isDetail(selected)) {
    setState('message', 'Open an individual transfer first.');
    return;
  }
  // No silent fallback to a vendor/demo verifier. Both transports must be pinned.
  if (
    !/^https:\/\/[^/?#]+$/.test(VERIFIER_ORIGIN) ||
    PROXY_URL !== VERIFIER_ORIGIN.replace(/^https:/, 'wss:') + '/proxy?token=app.revolut.com'
  ) {
    setState('message', 'Configure the reviewed verifier and its matching proxy first.');
    return;
  }
  const headers = {};
  const allowed = [
    'cookie',
    'authorization',
    'x-csrf-token',
    'x-xsrf-token',
    'user-agent',
    'accept',
    'accept-language',
    'origin',
    'referer',
    // Preserve captured application/device context without disclosing its values.
    'x-browser-application',
    'x-client-version',
    'x-device-id',
    'x-timezone',
  ];
  for (const header of selected.requestHeaders || []) {
    const name = header.name.toLowerCase();
    if (allowed.includes(name) && typeof header.value === 'string') headers[name] = header.value;
  }
  if (!headers.cookie && !headers.authorization) {
    setState('message', 'Authenticated detail-request headers are unavailable.');
    return;
  }
  headers.Host = 'app.revolut.com';
  headers['Accept-Encoding'] = 'identity';
  headers.Connection = 'close';
  const requestText =
    'GET ' +
    selected.url.slice('https://app.revolut.com'.length) +
    ' HTTP/1.1\r\n' +
    Object.entries(headers)
      .map(([key, value]) => key + ': ' + value)
      .join('\r\n') +
    '\r\n\r\n';
  // UTF-8 byte estimate plus room for extension-generated transport headers.
  let requestBytes = 512;
  for (const character of requestText) {
    const code = character.codePointAt(0);
    requestBytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  if (requestBytes > MAX_SENT_DATA) {
    setState(
      'message',
      'REQUEST_TOO_LARGE: this request exceeds the tested 4 KB proof budget. Stop here; no proof was started.',
    );
    return;
  }
  setState('pending', true);
  let completedSummary = null;
  try {
    const shapeOnly = mode === 'response-shape';
    const recordOnly = mode === 'payment-record';
    const handlers = recordOnly
      ? [
          {
            type: 'SENT',
            part: 'ALL',
            action: 'REVEAL',
            params: {
              type: 'regex',
              regex: '^GET /api/retail/transaction/[0-9a-fA-F-]{36} HTTP/1\\.1\\r\\n',
            },
          },
          {
            type: 'SENT',
            part: 'ALL',
            action: 'REVEAL',
            params: { type: 'regex', regex: '\\r\\n(?i:host):[ \\t]*app\\.revolut\\.com\\r\\n' },
          },
          { type: 'RECV', part: 'ALL', action: 'REVEAL' },
        ]
      : shapeOnly
        ? [
            { type: 'SENT', part: 'START_LINE', action: 'REVEAL' },
            { type: 'RECV', part: 'STATUS_CODE', action: 'REVEAL' },
            { type: 'RECV', part: 'HEADERS', action: 'REVEAL', params: { key: 'content-type' } },
            {
              type: 'RECV',
              part: 'ALL',
              action: 'REVEAL',
              params: { type: 'regex', regex: ROOT_REGEX },
            },
            {
              type: 'RECV',
              part: 'ALL',
              action: 'REVEAL',
              params: { type: 'regex', regex: KEYS_REGEX },
            },
          ]
        : [
            { type: 'SENT', part: 'START_LINE', action: 'REVEAL' },
            { type: 'RECV', part: 'START_LINE', action: 'REVEAL' },
            { type: 'RECV', part: 'HEADERS', action: 'REVEAL', params: { key: 'date' } },
            ...FIELDS.map((path) => ({
              type: 'RECV',
              part: 'BODY',
              action: 'REVEAL',
              params: { type: 'json', path },
            })),
          ];
    const result = await prove(
      { url: selected.url, method: 'GET', headers },
      {
        verifierUrl: VERIFIER_ORIGIN,
        proxyUrl: PROXY_URL,
        maxSentData: MAX_SENT_DATA,
        maxRecvData: MAX_RECV_DATA,
        handlers,
      },
    );
    const results = Array.isArray(result?.results) ? result.results : [];
    if (recordOnly) {
      const response = results.find((row) => row.type === 'RECV' && row.part === 'ALL');
      const status =
        typeof response?.value === 'string'
          ? /^HTTP\/1\.[01] ([1-5][0-9]{2})\b/.exec(response.value)
          : null;
      completedSummary = {
        diagnosticOnly: true,
        mode: 'payment-record',
        releaseGate: 'NOT_CLEARED',
        httpStatus: status ? Number(status[1]) : null,
        recordDisclosed: !!status,
      };
      setState('selected', null);
    } else if (shapeOnly) {
      const status = results.find((row) => row.type === 'RECV' && row.part === 'STATUS_CODE');
      const statusText = typeof status?.value === 'string' ? status.value.trim() : '';
      const contentType = results.find((row) => row.type === 'RECV' && row.part === 'HEADERS');
      const contentText =
        typeof contentType?.value === 'string' ? contentType.value.toLowerCase() : '';
      let rootType = 'unknown';
      const keys = [];
      for (const row of results) {
        if (row.type !== 'RECV' || row.part !== 'ALL' || typeof row.value !== 'string') continue;
        if (/^\s*(?:[0-9a-fA-F]+\s+)?[\[{]$/.test(row.value)) {
          rootType = row.value.trim().endsWith('[') ? 'array' : 'object';
        }
        const match = row.value.match(/^"([A-Za-z]+)"\s*:$/);
        if (match && SHAPE_KEYS.includes(match[1]) && !keys.includes(match[1])) keys.push(match[1]);
      }
      completedSummary = {
        diagnosticOnly: true,
        mode: 'response-shape',
        releaseGate: 'NOT_CLEARED',
        httpStatus: /^\d{3}$/.test(statusText) ? Number(statusText) : null,
        contentType: contentText.includes('json')
          ? 'json'
          : contentText.includes('html')
            ? 'html'
            : 'other-or-unknown',
        rootType,
        fieldNames: keys,
      };
    } else {
      // The pinned verifier returns key/value fragments, without params.path.
      // Parse only those fragments; never log their financial values.
      const fragments = [];
      for (const row of results) {
        if (row.type !== 'RECV' || row.part !== 'BODY' || typeof row.value !== 'string') continue;
        try {
          fragments.push(JSON.parse('{' + row.value + '}'));
        } catch {
          /* Missing/malformed diagnostic field. */
        }
      }
      const present = Object.fromEntries(
        FIELDS.map((path) => {
          const key = path.split('.').pop();
          return [
            path,
            fragments.some(
              (fragment) =>
                Object.prototype.hasOwnProperty.call(fragment, key) &&
                fragment[key] !== null &&
                fragment[key] !== '',
            ),
          ];
        }),
      );
      // Presence is diagnostic only. Do not return the private response to a launcher.
      const responseLine = results.find((row) => row.type === 'RECV' && row.part === 'START_LINE');
      const status =
        typeof responseLine?.value === 'string'
          ? responseLine.value.match(/^HTTP\/\d(?:\.\d)?\s+([1-5]\d{2})(?:\s|$)/)
          : null;
      completedSummary = {
        diagnosticOnly: true,
        mode: 'payment-fields',
        releaseGate: 'NOT_CLEARED',
        httpStatus: status ? Number(status[1]) : null,
        fieldsPresent: present,
      };
      if (Object.values(present).every(Boolean)) {
        setState('selected', null);
      } else {
        setState(
          'message',
          'Required fields are missing. Payment remains unverified. Nothing has been released.',
        );
      }
    }
  } catch (error) {
    // Errors may embed a private URL or headers. Do not stringify or log them.
    const errorText = typeof error?.message === 'string' ? error.message : '';
    const missing = errorText.match(/JSON path '([^']+)' not found/);
    let errorCode = 'PROOF_FAILED';
    if (missing && FIELDS.includes(missing[1])) {
      errorCode = 'RESPONSE_FIELD_MISSING';
      setState(
        'message',
        'The response is missing required field ' + missing[1] + '. The gate is not cleared.',
      );
    } else if (/setupProver timed out after (?:30000|60000)ms/.test(errorText)) {
      errorCode = 'MPC_SETUP_TIMEOUT';
      setState(
        'message',
        'MPC_SETUP_TIMEOUT: proof setup exceeded this extension build’s limit. Use Check connection only before another bank test.',
      );
    } else if (/context mux error|maximum number of streams/i.test(errorText)) {
      errorCode = 'MPC_SETUP_FAILED';
      setState(
        'message',
        'MPC_SETUP_FAILED: the proof protocol could not initialize. Payment remains unverified.',
      );
    } else if (/sendRequest timed out after 60000ms/.test(errorText)) {
      errorCode = 'HTTP_REQUEST_TIMEOUT';
      setState(
        'message',
        'HTTP_REQUEST_TIMEOUT: the bank request did not complete. Payment remains unverified.',
      );
    } else if (
      /Verification response timed out after 60000ms|Verification response not received after 60 retries/.test(
        errorText,
      )
    ) {
      errorCode = 'VERIFICATION_RESPONSE_TIMEOUT';
      setState(
        'message',
        'VERIFICATION_RESPONSE_TIMEOUT: the verifier result did not arrive. Payment remains unverified.',
      );
    } else {
      setState(
        'message',
        'The proof attempt failed. Payment remains unverified. Nothing has been released.',
      );
    }
    // Return only a fixed error code, never the original message or private URL.
    completedSummary = {
      diagnosticOnly: true,
      mode: 'attempt-error',
      releaseGate: 'NOT_CLEARED',
      errorCode,
    };
  } finally {
    setState('pending', false);
  }
  if (completedSummary) await done(JSON.stringify(completedSummary));
}

export default { config, main, generateProof, checkResponse };
