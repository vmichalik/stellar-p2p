// Bank-free TLSNotary extension diagnostic. The gateway injects three fixed
// same-origin URLs; no plugin-provided or page-provided value selects a target.
const VERIFIER_ORIGIN = '';
const PROXY_URL = '';
const WINDOW_URL = '';

const PUBLIC_URL = 'https://app.revolut.com/robots.txt';
const REQUEST_HEADERS = {
  Host: 'app.revolut.com',
  'Accept-Encoding': 'identity',
  Connection: 'close',
};
const MAX_SENT_DATA = 4096;
const MAX_RECV_DATA = 16384;

const config = {
  name: 'TLSNotary extension connection check',
  description: 'Proves a public GET response only. Does not access bank data.',
  urls: [WINDOW_URL],
  requests: [
    {
      method: 'GET',
      host: 'app.revolut.com',
      pathname: '/robots.txt',
      verifierUrl: VERIFIER_ORIGIN,
    },
  ],
};

function configuredEndpointsAreValid() {
  return (
    /^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/.test(VERIFIER_ORIGIN) &&
    PROXY_URL === VERIFIER_ORIGIN.replace(/^https:/, 'wss:') + '/proxy?token=app.revolut.com' &&
    WINDOW_URL === VERIFIER_ORIGIN + '/extension-check/window'
  );
}

function main() {
  const configured = configuredEndpointsAreValid();
  const pending = useState('pending', false);
  const message = useState(
    'message',
    configured
      ? 'This check sends a public GET request to app.revolut.com/robots.txt. It does not use bank credentials.'
      : 'The private verifier configuration is missing or invalid. No request was made.',
  );

  if (configured) {
    useEffect(() => {
      openWindow(WINDOW_URL);
    }, []);
  }

  return div(
    {
      style: {
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: '2147483647',
        width: '320px',
        padding: '16px',
        borderRadius: '12px',
        backgroundColor: 'white',
        color: '#111',
        boxShadow: '0 4px 24px #0004',
        fontFamily: 'system-ui',
        fontSize: '14px',
      },
    },
    [
      div({ style: { fontWeight: '700', marginBottom: '8px' } }, ['TLSNotary connection check']),
      div({}, ['Public endpoint: GET https://app.revolut.com/robots.txt']),
      div({}, ['No bank login, cookies, or authorization headers are used.']),
      div({ style: { marginTop: '8px' } }, [message]),
      configured && !pending
        ? button({ onclick: 'checkExtension' }, ['Run public connection check'])
        : div({}, [pending ? 'Checking connection…' : 'No request was made.']),
    ],
  );
}

async function checkExtension() {
  if (useState('pending', false)) return;
  if (!configuredEndpointsAreValid()) {
    setState(
      'message',
      'The private verifier configuration is missing or invalid. No request was made.',
    );
    return;
  }

  setState('pending', true);
  setState('message', 'Checking the public endpoint…');
  let summary = null;

  try {
    const result = await prove(
      {
        url: PUBLIC_URL,
        method: 'GET',
        headers: { ...REQUEST_HEADERS },
      },
      {
        verifierUrl: VERIFIER_ORIGIN,
        proxyUrl: PROXY_URL,
        maxSentData: MAX_SENT_DATA,
        maxRecvData: MAX_RECV_DATA,
        handlers: [
          { type: 'SENT', part: 'START_LINE', action: 'REVEAL' },
          { type: 'RECV', part: 'STATUS_CODE', action: 'REVEAL' },
        ],
      },
    );

    if (!Array.isArray(result?.results)) throw new Error('EXTENSION_CHECK_FAILED');
    const statusRow = result.results.find(
      (row) => row?.type === 'RECV' && row?.part === 'STATUS_CODE',
    );
    const statusText = typeof statusRow?.value === 'string' ? statusRow.value.trim() : '';
    const httpStatus = /^\d{3}$/.test(statusText) ? Number(statusText) : null;

    summary = {
      diagnosticOnly: true,
      mode: 'extension-check',
      releaseGate: 'NOT_CLEARED',
      bankRequestMade: false,
      publicRequestMade: true,
      httpStatus,
    };
    setState(
      'message',
      httpStatus === null
        ? 'Public check completed, but no HTTP status was recognized. The release gate remains NOT CLEARED.'
        : `Public check completed (HTTP ${httpStatus}). The release gate remains NOT CLEARED.`,
    );
  } catch (error) {
    const errorText = typeof error?.message === 'string' ? error.message : '';
    let errorCode = 'EXTENSION_CHECK_FAILED';
    if (/setupProver timed out after 30000ms|MPC_SETUP_TIMEOUT/i.test(errorText)) {
      errorCode = 'MPC_SETUP_TIMEOUT';
    } else if (/context mux error|maximum number of streams|MPC_SETUP_FAILED/i.test(errorText)) {
      errorCode = 'MPC_SETUP_FAILED';
    }
    summary = {
      diagnosticOnly: true,
      mode: 'extension-check',
      releaseGate: 'NOT_CLEARED',
      bankRequestMade: false,
      // Once setup has started, a generic failure does not tell us whether the
      // public server request ran. Setup failures happen before that request.
      publicRequestMade: errorCode === 'EXTENSION_CHECK_FAILED' ? null : false,
      errorCode,
    };
    setState(
      'message',
      errorCode === 'MPC_SETUP_TIMEOUT'
        ? 'MPC_SETUP_TIMEOUT: the verifier setup did not finish. No bank request was made.'
        : errorCode === 'MPC_SETUP_FAILED'
          ? 'MPC_SETUP_FAILED: the verifier protocol did not initialize. No bank request was made.'
          : 'EXTENSION_CHECK_FAILED: the public connection check did not complete. No bank request was made.',
    );
  } finally {
    setState('pending', false);
  }

  // The callback contains only a fixed diagnostic schema and public HTTP status.
  if (summary) await done(JSON.stringify(summary));
}

export default { config, main, checkExtension };
