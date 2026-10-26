import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { NETWORKS } from './network.mjs';
import { createHostClient, TESTNET_PASSPHRASE, readDeploymentDomain } from './host-client.mjs';

// Shape-only disposable identities/signatures. The host bridge's separate
// tests perform actual SDK signature verification; these test browser transport.
const ACCOUNT = 'G' + 'A'.repeat(55),
  OTHER = 'G' + 'B'.repeat(55);
const DEPLOYMENT = {
  networkPassphrase: TESTNET_PASSPHRASE,
  contract: 'C' + 'C'.repeat(55),
  token: 'C' + 'D'.repeat(55),
  tokenDecimals: 7,
  tokenLabel: 'Test token',
};
const ID = 'o'.repeat(43),
  CHALLENGE = 'c'.repeat(43),
  REQUEST = 'r'.repeat(43);
const SIGNATURE = new Uint8Array(64).fill(17);
const UNSIGNED = btoa('synthetic unsigned transaction');
const SIGNED = btoa('synthetic signed transaction');
const recovery = () => ({
  requestId: REQUEST,
  orderId: '0',
  networkPassphrase: TESTNET_PASSPHRASE,
  contract: 'C' + 'C'.repeat(55),
  token: 'C' + 'D'.repeat(55),
  buyer: OTHER,
  seller: ACCOUNT,
  tokenAmount: '220000000',
  buyerTokens: '100000001',
  sellerTokens: '119999999',
  orderState: 'Paying',
  expirationLedger: 512,
  expiresAt: 61_000,
  fiatMinor: '2000',
  currency: 'EUR',
  rail: 'revolut',
  status: 'queued',
});
const CLAIM = 'k'.repeat(43),
  PREIMAGE = btoa('synthetic authorization preimage');

function fixture(options = {}) {
  const state = {
    now: 1_000,
    authenticated: false,
    account: ACCOUNT,
    network: options.deployment?.networkPassphrase ?? TESTNET_PASSPHRASE,
    deployment: structuredClone(options.deployment ?? DEPLOYMENT),
    requests: [],
    walletCalls: [],
    replies: [],
    commands: 0,
    polls: 0,
  };
  const location = { origin: 'https://pactlane.example.test' };
  const response = (body, status = 200, extra = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    json: async () => body,
    ...extra,
  });
  const domain = () => readDeploymentDomain(state.deployment);
  const info = () => ({
    account: ACCOUNT,
    ...domain(),
    expiresAt: state.now + 60_000,
  });
  const walletRequest = (
    method = 'sign',
    args = { transactionXdr: UNSIGNED, account: ACCOUNT, ...domain() },
    id = REQUEST,
  ) => ({ operationId: ID, status: 'running', walletRequest: { id, method, args } });
  const walletMethods = {
    requestAccess: async () => ({ address: state.account }),
    getAddress: async () => ({ address: state.account }),
    getNetworkDetails: async () => ({ networkPassphrase: state.network }),
    signMessage: async () => ({ signedMessage: SIGNATURE, signerAddress: state.account }),
    signTransaction: async () => ({ signedTxXdr: SIGNED, signerAddress: state.account }),
    signAuthEntry: async () => ({
      signedAuthEntry: btoa(String.fromCharCode(...SIGNATURE)),
      signerAddress: state.account,
    }),
    ...options.wallet,
  };
  const freighter = Object.fromEntries(
    Object.entries(walletMethods).map(([name, fn]) => [
      name,
      async (...args) => {
        state.walletCalls.push({ name, args });
        return fn(...args);
      },
    ]),
  );
  async function fetch(path, init) {
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    state.requests.push({ path, init, body });
    if (options.intercept) {
      const custom = await options.intercept({
        path,
        init,
        body,
        state,
        response,
        info,
        walletRequest,
      });
      if (custom !== undefined) return custom;
    }
    if (path === '/api/session/challenge') {
      const expiresAt = state.now + 60_000;
      return response({
        challengeId: CHALLENGE,
        expiresAt,
        ...domain(),
        message: `Pactlane wallet session\nOrigin: ${location.origin}\nNetwork: ${domain().networkPassphrase}\nDeployment: ${domain().deploymentId}\nContract: ${domain().contract}\nToken: ${domain().token}\nAccount: ${body.account}\nNonce: ${CHALLENGE}\nExpires: ${expiresAt}\nThis authenticates this browser session only. It does not authorize a transaction.`,
      });
    }
    if (path === '/api/session/verify') {
      state.authenticated = true;
      return response(info());
    }
    if (path === '/api/session' && init.method === 'DELETE') {
      state.authenticated = false;
      return response({ ended: true });
    }
    if (path === '/api/session')
      return state.authenticated
        ? response(info())
        : response({ error: 'AUTHENTICATION_REQUIRED' }, 401);
    if (path === '/api/view')
      return response({
        configured: true,
        deployment: structuredClone(state.deployment),
        orders: [],
        available: false,
      });
    if (path === '/api/commands') {
      state.commands++;
      return response({ operationId: ID }, 202);
    }
    if (path.includes('/wallet-results/')) {
      state.replies.push(body);
      return response({ accepted: true });
    }
    if (path === `/api/operations/${ID}`) {
      state.polls++;
      return response(
        options.job
          ? options.job({ state, walletRequest })
          : { operationId: ID, status: 'completed', result: { orderId: '7' } },
      );
    }
    assert.fail('Unexpected client route: ' + path);
  }
  const client = createHostClient({
    freighter,
    fetch,
    location,
    clock: () => state.now,
    pause: async () => {
      state.now += 5;
    },
    pollIntervalMs: 5,
    operationTimeoutMs: 100,
    ...options.client,
  });
  return { client, state, location, info, response };
}

test('authenticates exact account/network challenge and converts the typed Freighter signature canonically', async () => {
  const f = fixture();
  assert.equal(await f.client.session(), null);
  assert.equal((await f.client.authenticate()).account, ACCOUNT);
  const signature = f.state.requests.find((r) => r.path === '/api/session/verify').body.signature;
  assert.equal(signature, btoa(String.fromCharCode(...SIGNATURE)));
  const signed = f.state.walletCalls.find((r) => r.name === 'signMessage');
  assert.ok(signed.args[0].includes(f.location.origin));
  assert.deepEqual(signed.args[1], { address: ACCOUNT, networkPassphrase: TESTNET_PASSPHRASE });
  for (const { path, init } of f.state.requests) {
    assert.ok(path.startsWith('/api/'));
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.mode, 'same-origin');
    assert.equal(init.redirect, 'error');
  }
  assert.equal(
    (await f.client.view()).deployment.deploymentId,
    readDeploymentDomain(DEPLOYMENT).deploymentId,
  );
  await f.client.logout();
  assert.equal(await f.client.session(), null);
});

test('creating a private offer sends exact amounts without requesting a transaction signature', async () => {
  const draft = {
    id: 'new-offer',
    publicTerms: { seller: ACCOUNT, token_amount: '10000000', fiat_minor: '89' },
  };
  const f = fixture({ job: () => ({ operationId: ID, status: 'completed', result: draft }) });
  await f.client.authenticate();
  const result = await f.client.command('createOffer', {
    tokenAmount: '10000000',
    fiatMinor: '89',
  });
  assert.deepEqual(result.result, draft);
  const request = f.state.requests.find((item) => item.path === '/api/commands');
  assert.equal(request.body.action, 'createOffer');
  assert.deepEqual(request.body.args, { tokenAmount: '10000000', fiatMinor: '89' });
  assert.equal(
    f.state.walletCalls.some((item) => ['signTransaction', 'signAuthEntry'].includes(item.name)),
    false,
  );
});

test('refuses a tampered challenge before opening a message-signing prompt', async () => {
  const f = fixture({
    intercept: ({ path, response, state }) =>
      path === '/api/session/challenge'
        ? response({
            challengeId: CHALLENGE,
            expiresAt: state.now + 60_000,
            ...readDeploymentDomain(DEPLOYMENT),
            message: 'Sign a message for another origin/account',
          })
        : undefined,
  });
  await assert.rejects(f.client.authenticate(), { code: 'HOST_CHALLENGE_INVALID' });
  assert.equal(
    f.state.walletCalls.some((r) => r.name === 'signMessage'),
    false,
  );
  assert.equal(
    f.state.requests.some((r) => r.path === '/api/session/verify'),
    false,
  );
});

test('rejects a mismatched message signer or malformed signature without authenticating', async () => {
  for (const result of [
    { signedMessage: SIGNATURE, signerAddress: OTHER },
    { signedMessage: 'not base64', signerAddress: ACCOUNT },
    { signedMessage: new Uint8Array(63), signerAddress: ACCOUNT },
  ]) {
    const f = fixture({ wallet: { signMessage: async () => result } });
    await assert.rejects(f.client.authenticate());
    assert.equal(
      f.state.requests.some((r) => r.path === '/api/session/verify'),
      false,
    );
  }
});

test('dispatches only the four wallet methods and prompts once when a replied request appears again', async () => {
  const methods = ['connect', 'selected', 'network', 'sign'];
  let repeat = true;
  const f = fixture({
    job: ({ state, walletRequest }) => {
      const index = state.replies.length;
      if (index === 4) {
        if (repeat) {
          repeat = false;
          return walletRequest('sign', undefined, 'd'.repeat(43));
        }
        return { operationId: ID, status: 'completed', result: { confirmed: true } };
      }
      return walletRequest(
        methods[index],
        index === 3 ? undefined : {},
        String.fromCharCode(97 + index).repeat(43),
      );
    },
  });
  await f.client.authenticate();
  const progress = [];
  const result = await f.client.command(
    'connectWallet',
    { party: 'buyer' },
    { onProgress: (value) => progress.push(value) },
  );
  assert.deepEqual(result, { operationId: ID, result: { confirmed: true } });
  assert.deepEqual(
    f.state.replies.map((r) => r.result),
    [ACCOUNT, ACCOUNT, TESTNET_PASSPHRASE, SIGNED],
  );
  assert.equal(f.state.walletCalls.filter((r) => r.name === 'signTransaction').length, 1);
  assert.equal(f.state.commands, 1);
  assert.deepEqual(
    progress.filter((r) => r.status === 'wallet').map((r) => r.walletMethod),
    methods,
  );
});

test('refuses switched wallets or networks before submitting a new command', async () => {
  for (const change of ['account', 'network']) {
    const f = fixture();
    await f.client.authenticate();
    f.state[change] =
      change === 'account' ? OTHER : 'Public Global Stellar Network ; September 2015';
    await assert.rejects(f.client.command('reserve', { orderId: '7' }), (error) => {
      assert.equal(error.outcome, 'not-submitted');
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(f.state.commands, 0);
  }
});

test('refuses sign requests with a different account/network or an unrecognized wallet method', async () => {
  for (const variant of ['account', 'network', 'method']) {
    const f = fixture({
      job: ({ walletRequest }) => {
        const job = walletRequest();
        if (variant === 'account') job.walletRequest.args.account = OTHER;
        if (variant === 'network') job.walletRequest.args.networkPassphrase = 'different network';
        if (variant === 'method') job.walletRequest.method = 'signAuthEntry';
        return job;
      },
    });
    await f.client.authenticate();
    await assert.rejects(f.client.command('beginPayment', { orderId: '7' }), (error) => {
      assert.equal(error.operationId, ID);
      assert.equal(error.outcome, 'unknown');
      return true;
    });
    assert.equal(
      f.state.walletCalls.some((r) => r.name === 'signTransaction'),
      false,
    );
  }
});

test('checks the selected network again immediately before and after transaction signing', async () => {
  for (const after of [false, true]) {
    let f;
    f = fixture({
      job: ({ state, walletRequest }) => {
        if (!after) state.network = 'changed network';
        return walletRequest();
      },
      wallet: {
        signTransaction: async () => {
          if (after) f.state.network = 'changed network';
          return { signedTxXdr: SIGNED, signerAddress: ACCOUNT };
        },
      },
    });
    await f.client.authenticate();
    await assert.rejects(f.client.command('beginPayment', { orderId: '7' }), {
      code: 'WALLET_NETWORK_CHANGED',
      outcome: 'unknown',
    });
    assert.equal(
      f.state.walletCalls.filter((r) => r.name === 'signTransaction').length,
      after ? 1 : 0,
    );
    assert.deepEqual(f.state.replies, [{ error: 'WALLET_UNAVAILABLE' }]);
  }
});

test('only pinned Freighter returned rejection code -4 with no signed envelope permits an explicit signing retry', async () => {
  for (const scenario of ['declined', 'provider', 'exception', 'contradictory-envelope']) {
    const f = fixture({
      job: ({ walletRequest }) => walletRequest(),
      wallet: {
        signTransaction: async () => {
          if (scenario === 'exception') throw { code: -4, message: 'private provider failure' };
          return {
            signedTxXdr: scenario === 'contradictory-envelope' ? SIGNED : '',
            signerAddress: '',
            error: {
              code: ['declined', 'contradictory-envelope'].includes(scenario) ? -4 : -1,
              message: 'The user rejected this request. private information',
            },
          };
        },
      },
    });
    await f.client.authenticate();
    await assert.rejects(f.client.command('beginPayment', { orderId: '7' }), (error) => {
      assert.equal(error.code, scenario === 'declined' ? 'WALLET_REJECTED' : 'WALLET_UNAVAILABLE');
      assert.equal(error.retryable, scenario === 'declined');
      assert.equal(error.outcome, scenario === 'declined' ? 'failed' : 'unknown');
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
    assert.deepEqual(f.state.replies, [
      { error: scenario === 'declined' ? 'WALLET_REJECTED' : 'WALLET_UNAVAILABLE' },
    ]);
    assert.equal(f.state.commands, 1);
  }
});

test('a lost command response is unknown and never causes automatic command resubmission', async () => {
  const f = fixture({
    intercept: ({ path, state }) => {
      if (path === '/api/commands') {
        state.commands++;
        throw new Error('private network details');
      }
    },
  });
  await f.client.authenticate();
  await assert.rejects(f.client.command('reserve', { orderId: '7' }), {
    code: 'HOST_UNREACHABLE',
    outcome: 'unknown',
    operationId: null,
  });
  assert.equal(f.state.commands, 1);
  assert.equal(f.client.lastOperation().outcome, 'unknown');
});

test('a lost signed-wallet reply retains its operation ID and never prompts again during resume', async () => {
  const f = fixture({
    job: ({ walletRequest }) => walletRequest(),
    intercept: ({ path, state, body }) => {
      if (path.includes('/wallet-results/')) {
        state.replies.push(body);
        throw new Error('reply lost');
      }
    },
  });
  await f.client.authenticate();
  await assert.rejects(f.client.command('beginPayment', { orderId: '7' }), {
    code: 'HOST_UNREACHABLE',
    outcome: 'unknown',
    operationId: ID,
  });
  assert.equal(f.client.lastOperation().operationId, ID);
  await assert.rejects(f.client.resumeOperation(ID), {
    code: 'WALLET_REPLY_UNCERTAIN',
    outcome: 'unknown',
    operationId: ID,
  });
  assert.equal(f.state.commands, 1);
  assert.equal(f.state.replies.length, 1);
  assert.equal(f.state.walletCalls.filter((r) => r.name === 'signTransaction').length, 1);
});

test('poll timeout preserves an operation and explicit resume only polls its existing job', async () => {
  let completed = false;
  const f = fixture({
    client: { operationTimeoutMs: 20 },
    job: () =>
      completed
        ? { operationId: ID, status: 'completed', result: { orderId: '7' } }
        : { operationId: ID, status: 'running' },
  });
  await f.client.authenticate();
  await assert.rejects(f.client.command('reserve', { orderId: '7' }), {
    code: 'CLIENT_TIMEOUT',
    outcome: 'unknown',
    operationId: ID,
  });
  completed = true;
  assert.deepEqual(await f.client.resumeOperation(ID), {
    operationId: ID,
    result: { orderId: '7' },
  });
  assert.equal(f.state.commands, 1);
});

test('abort during an open wallet prompt ignores its late result and retains unknown operation state', async () => {
  let finishSigning;
  const f = fixture({
    job: ({ walletRequest }) => walletRequest(),
    wallet: {
      signTransaction: () =>
        new Promise((resolve) => {
          finishSigning = resolve;
        }),
    },
  });
  await f.client.authenticate();
  const controller = new AbortController();
  const pending = f.client.command('beginPayment', { orderId: '7' }, { signal: controller.signal });
  const rejected = assert.rejects(pending, {
    code: 'CLIENT_ABORTED',
    outcome: 'unknown',
    operationId: ID,
  });
  for (let i = 0; !finishSigning && i < 50; i++) await setImmediate();
  assert.equal(typeof finishSigning, 'function');
  controller.abort();
  await rejected;
  await assert.rejects(f.client.resumeOperation(ID), {
    code: 'CLIENT_OPERATION_IN_PROGRESS',
    operationId: ID,
    outcome: 'unknown',
  });
  finishSigning({ signedTxXdr: SIGNED, signerAddress: ACCOUNT });
  await setImmediate();
  assert.equal(f.state.replies.length, 0);
  await assert.rejects(f.client.resumeOperation(ID), { code: 'WALLET_REPLY_UNCERTAIN' });
  assert.equal(f.state.walletCalls.filter((r) => r.name === 'signTransaction').length, 1);
});

test('a session response arriving after logout cannot restore the old authenticated client state', async () => {
  let finishSession;
  let delay = false;
  const f = fixture({
    intercept: ({ path, init, response, info }) => {
      if (delay && path === '/api/session' && init.method === 'GET')
        return new Promise((resolve) => {
          finishSession = () => resolve(response(info()));
        });
    },
  });
  await f.client.authenticate();
  delay = true;
  const pending = f.client.session();
  const rejected = assert.rejects(pending, { code: 'CLIENT_SESSION_CHANGED' });
  await f.client.logout();
  finishSession();
  await rejected;
  delay = false;
  assert.equal(await f.client.session(), null);
});

test('an old completed operation cannot enter the view after the authenticated account changes', async () => {
  let finishPoll;
  let switched = false;
  const f = fixture({
    intercept: ({ path, response, info }) => {
      if (path === `/api/operations/${ID}`)
        return new Promise((resolve) => {
          finishPoll = () =>
            resolve(
              response({ operationId: ID, status: 'completed', result: { oldAccount: true } }),
            );
        });
      if (switched && path === '/api/session') return response({ ...info(), account: OTHER });
    },
  });
  await f.client.authenticate();
  const pending = f.client.command('getOrder', { orderId: '7' });
  const rejected = assert.rejects(pending, {
    code: 'WALLET_ACCOUNT_CHANGED',
    operationId: ID,
    outcome: 'unknown',
  });
  for (let i = 0; !finishPoll && i < 50; i++) await setImmediate();
  assert.equal(typeof finishPoll, 'function');
  switched = true;
  await f.client.session();
  finishPoll();
  await rejected;
  assert.equal(f.client.lastOperation().outcome, 'unknown');
});

test('server preparation failure exposes safe retry metadata without retrying the command', async () => {
  const f = fixture({
    job: () => ({ operationId: ID, status: 'failed', error: 'TRANSACTION_PREPARATION_RETRYABLE' }),
  });
  await f.client.authenticate();
  await assert.rejects(f.client.command('reserve', { orderId: '7' }), {
    code: 'TRANSACTION_PREPARATION_RETRYABLE',
    outcome: 'failed',
    retryable: true,
    operationId: ID,
  });
  assert.equal(f.state.commands, 1);
});

test('refuses cross-origin responses, unsupported actions and caller-selected endpoint origins', async () => {
  assert.throws(() => createHostClient({ location: { origin: 'http://public.example.test' } }));
  const f = fixture({
    intercept: ({ path, response }) =>
      path === '/api/view'
        ? response({}, 200, { url: 'https://other.example.test/api/view' })
        : undefined,
  });
  await assert.rejects(f.client.view(), { code: 'HOST_RESPONSE_INVALID' });
  assert.throws(() => f.client.command('https://other.example.test/submit', {}), {
    code: 'ACTION_UNAVAILABLE',
  });
  assert.throws(() => f.client.command('unilateralRecovery', { orderId: '7' }), {
    code: 'ACTION_UNAVAILABLE',
  });
  f.location.origin = 'https://changed.example.test';
  await assert.rejects(f.client.view(), { code: 'CLIENT_ORIGIN_CHANGED' });
});

test('definite host preflight refusals leave no unknown transaction and never retry automatically', async () => {
  for (const code of [
    'HOST_NOT_CONFIGURED',
    'PAYMENT_VERIFICATION_UNAVAILABLE',
    'OFFER_NOT_APPROVED',
    'CATALOG_LIMIT',
    'DEPLOYMENT_UNAVAILABLE',
  ]) {
    const f = fixture({ job: () => ({ operationId: ID, status: 'failed', error: code }) });
    await f.client.authenticate();
    await assert.rejects(f.client.command('beginPayment', { orderId: '7' }), {
      code,
      outcome: 'failed',
    });
    assert.equal(f.state.commands, 1);
    assert.equal(
      f.state.walletCalls.some((call) => call.name === 'signTransaction'),
      false,
    );
  }
});

test('recovery accepts a shorter session expiry, signs once and returns only the seller signature to the host', async () => {
  const f = fixture({
    intercept: ({ path, response }) => {
      if (path.endsWith('/claim'))
        return response({
          ...recovery(),
          expiresAt: 60_000,
          status: 'claimed',
          claimToken: CLAIM,
          preimageXdr: PREIMAGE,
        });
      if (path.endsWith('/respond')) return response({ accepted: true });
    },
  });
  await f.client.authenticate();
  assert.deepEqual(await f.client.approveRecovery(recovery()), {
    requestId: REQUEST,
    accepted: true,
    approved: true,
  });
  const signed = f.state.walletCalls.filter((call) => call.name === 'signAuthEntry');
  assert.equal(signed.length, 1);
  assert.deepEqual(signed[0].args, [
    PREIMAGE,
    { address: ACCOUNT, networkPassphrase: TESTNET_PASSPHRASE },
  ]);
  assert.deepEqual(f.state.requests.find((item) => item.path.endsWith('/respond')).body, {
    claimToken: CLAIM,
    signature: btoa(String.fromCharCode(...SIGNATURE)),
    signerAddress: ACCOUNT,
  });
  assert.equal(
    f.state.walletCalls.some((call) => call.name === 'signTransaction'),
    false,
  );
  await assert.rejects(f.client.approveRecovery(recovery()), {
    code: 'RECOVERY_REQUEST_ALREADY_CLAIMED',
  });
  assert.equal(f.state.requests.filter((item) => item.path.endsWith('/claim')).length, 1);
});

test('recovery refuses changed reviewed terms before a wallet prompt, including changed but balanced splits', async () => {
  for (const changed of [
    { buyerTokens: '100000000', sellerTokens: '120000000' },
    { contract: 'C' + 'E'.repeat(55) },
    { expirationLedger: 513 },
    { expiresAt: 62_000 },
  ]) {
    const f = fixture({
      intercept: ({ path, response }) => {
        if (path.endsWith('/claim'))
          return response({
            ...recovery(),
            ...changed,
            status: 'claimed',
            claimToken: CLAIM,
            preimageXdr: PREIMAGE,
          });
        if (path.endsWith('/respond')) return response({ accepted: true });
      },
    });
    await f.client.authenticate();
    await assert.rejects(f.client.approveRecovery(recovery()), {
      code: 'RECOVERY_REQUEST_CHANGED',
    });
    assert.equal(
      f.state.walletCalls.some((call) => call.name === 'signAuthEntry'),
      false,
    );
    assert.equal(
      f.state.requests.some((item) => item.path.endsWith('/respond') && item.body?.signature),
      false,
    );
  }
});

test('declining a recovery claims once and sends a refusal without requesting a signature', async () => {
  const f = fixture({
    intercept: ({ path, response }) => {
      if (path.endsWith('/claim'))
        return response({
          ...recovery(),
          status: 'claimed',
          claimToken: CLAIM,
          preimageXdr: PREIMAGE,
        });
      if (path.endsWith('/respond')) return response({ accepted: true });
    },
  });
  await f.client.authenticate();
  assert.equal((await f.client.rejectRecovery(recovery())).approved, false);
  assert.deepEqual(f.state.requests.find((item) => item.path.endsWith('/respond')).body, {
    claimToken: CLAIM,
    error: 'RECOVERY_REJECTED',
  });
  assert.equal(
    f.state.walletCalls.some((call) => call.name === 'signAuthEntry'),
    false,
  );
});

test('recovery rejects malformed signatures and explicit refusal without sending approval', async () => {
  for (const reply of [
    { signedAuthEntry: SIGNED, signerAddress: ACCOUNT },
    { signedAuthEntry: null, signerAddress: '', error: { code: -4 } },
  ]) {
    const f = fixture({
      wallet: { signAuthEntry: async () => reply },
      intercept: ({ path, response }) => {
        if (path.endsWith('/claim'))
          return response({
            ...recovery(),
            status: 'claimed',
            claimToken: CLAIM,
            preimageXdr: PREIMAGE,
          });
        if (path.endsWith('/respond')) return response({ accepted: true });
      },
    });
    await f.client.authenticate();
    await assert.rejects(f.client.approveRecovery(recovery()));
    const body = f.state.requests.find((item) => item.path.endsWith('/respond')).body;
    assert.equal(Object.hasOwn(body, 'signature'), false);
    assert.equal(body.error, reply.error ? 'WALLET_REJECTED' : 'WALLET_OPERATION_UNKNOWN');
  }
});

test('an uncertain recovery reply is never retried or signed twice', async () => {
  const f = fixture({
    intercept: ({ path, response }) => {
      if (path.endsWith('/claim'))
        return response({
          ...recovery(),
          status: 'claimed',
          claimToken: CLAIM,
          preimageXdr: PREIMAGE,
        });
      if (path.endsWith('/respond')) throw Error('connection lost');
    },
  });
  await f.client.authenticate();
  await assert.rejects(f.client.approveRecovery(recovery()), { outcome: 'unknown' });
  await assert.rejects(f.client.approveRecovery(recovery()), {
    code: 'RECOVERY_REQUEST_ALREADY_CLAIMED',
  });
  assert.equal(f.state.walletCalls.filter((call) => call.name === 'signAuthEntry').length, 1);
  assert.equal(f.state.requests.filter((item) => item.path.endsWith('/respond')).length, 1);
});

test('logout while recovery approval is open discards the late signature', async () => {
  let complete;
  const f = fixture({
    wallet: {
      signAuthEntry: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    },
    intercept: ({ path, response }) => {
      if (path.endsWith('/claim'))
        return response({
          ...recovery(),
          status: 'claimed',
          claimToken: CLAIM,
          preimageXdr: PREIMAGE,
        });
      if (path.endsWith('/respond')) return response({ accepted: true });
    },
  });
  await f.client.authenticate();
  const approval = f.client.approveRecovery(recovery());
  const rejected = assert.rejects(approval, { outcome: 'unknown' });
  for (let i = 0; !complete && i < 50; i++) await setImmediate();
  assert.equal(typeof complete, 'function');
  await f.client.logout();
  complete({ signedAuthEntry: btoa(String.fromCharCode(...SIGNATURE)), signerAddress: ACCOUNT });
  await rejected;
  await setImmediate();
  assert.equal(
    f.state.requests.some((item) => item.path.endsWith('/respond')),
    false,
  );
});

const mainnetDeployment = () => ({
  ...DEPLOYMENT,
  network: 'mainnet',
  networkPassphrase: NETWORKS.mainnet.passphrase,
  tokenLabel: 'USDC',
  asset: { code: 'USDC', issuer: OTHER },
});

test('explicit mainnet binds challenge, transaction and recovery prompts to one deployment', async () => {
  const deployment = mainnetDeployment();
  const domain = readDeploymentDomain(deployment);
  const reviewed = { ...recovery(), ...domain };
  const f = fixture({
    deployment,
    job: ({ state, walletRequest }) =>
      state.polls === 1
        ? walletRequest()
        : { operationId: ID, status: 'completed', result: { orderId: '0' } },
    intercept: ({ path, response }) => {
      if (path.endsWith('/claim'))
        return response({
          ...reviewed,
          status: 'claimed',
          claimToken: CLAIM,
          preimageXdr: PREIMAGE,
        });
      if (path.endsWith('/respond')) return response({ accepted: true });
    },
  });
  const session = await f.client.authenticate();
  assert.equal(session.deploymentId, domain.deploymentId);
  assert.equal(session.network, 'mainnet');
  await f.client.command('reserve', { orderId: '0' });
  await f.client.approveRecovery(reviewed);
  for (const method of ['signMessage', 'signTransaction', 'signAuthEntry']) {
    const calls = f.state.walletCalls.filter((call) => call.name === method);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args[1].networkPassphrase, NETWORKS.mainnet.passphrase);
  }
  const challenge = f.state.walletCalls.find((call) => call.name === 'signMessage').args[0];
  assert.ok(challenge.includes(`Deployment: ${domain.deploymentId}`));
  assert.ok(challenge.includes(`Token: ${deployment.token}`));
});

test('mainnet cannot be selected implicitly or without a specific issued asset', async () => {
  for (const deployment of [
    { ...mainnetDeployment(), network: undefined },
    { ...mainnetDeployment(), asset: undefined },
    { ...mainnetDeployment(), network: 'testnet' },
  ]) {
    const f = fixture({ deployment });
    await assert.rejects(f.client.authenticate(), { code: 'HOST_DEPLOYMENT_INVALID' });
    assert.deepEqual(f.state.walletCalls, []);
  }
});

test('a deployment change after review is rejected before any wallet-access prompt', async () => {
  for (const field of ['contract', 'token']) {
    const f = fixture({ deployment: mainnetDeployment() });
    await f.client.view();
    f.state.deployment[field] = 'C' + 'E'.repeat(55);
    await assert.rejects(f.client.authenticate(), { code: 'CLIENT_DEPLOYMENT_CHANGED' });
    assert.deepEqual(f.state.walletCalls, []);
  }
});

test('a changed deployment after wallet signing discards the signature and preserves an unknown outcome', async () => {
  let f;
  f = fixture({
    deployment: mainnetDeployment(),
    wallet: {
      signTransaction: async () => {
        f.state.deployment.token = 'C' + 'E'.repeat(55);
        return { signedTxXdr: SIGNED, signerAddress: ACCOUNT };
      },
    },
    job: ({ walletRequest }) => walletRequest(),
  });
  await f.client.authenticate();
  await assert.rejects(f.client.command('reserve', { orderId: '0' }), {
    code: 'CLIENT_DEPLOYMENT_CHANGED',
    outcome: 'unknown',
  });
  assert.equal(f.state.walletCalls.filter((call) => call.name === 'signTransaction').length, 1);
  assert.equal(
    f.state.replies.some((reply) => reply.result === SIGNED),
    false,
  );
});

test('cross-network session and same-network wrong-token requests cannot reuse an authenticated account', async () => {
  let crossSession = false;
  const f = fixture({
    deployment: mainnetDeployment(),
    intercept: ({ path, response, info }) =>
      path === '/api/session' && crossSession
        ? response({ ...info(), ...readDeploymentDomain(DEPLOYMENT) })
        : undefined,
    job: ({ walletRequest }) => {
      const incoming = walletRequest();
      Object.assign(
        incoming.walletRequest.args,
        readDeploymentDomain({ ...mainnetDeployment(), token: 'C' + 'E'.repeat(55) }),
      );
      return incoming;
    },
  });
  await f.client.authenticate();
  crossSession = true;
  await assert.rejects(f.client.session(), { code: 'HOST_SESSION_INVALID' });
  crossSession = false;
  await assert.rejects(f.client.command('reserve', { orderId: '0' }), {
    code: 'WALLET_REQUEST_INVALID',
  });
  assert.equal(
    f.state.walletCalls.some((call) => call.name === 'signTransaction'),
    false,
  );
});

test('receiving-account preflight failure is a definite retryable result without an unknown operation', async () => {
  let ready = false;
  const f = fixture({
    deployment: mainnetDeployment(),
    job: () =>
      ready
        ? { operationId: ID, status: 'completed', result: { orderId: '0' } }
        : { operationId: ID, status: 'failed', error: 'RECEIVING_TRUSTLINE_MISSING' },
  });
  await f.client.authenticate();
  await assert.rejects(f.client.command('reserve', { orderId: '0' }), {
    code: 'RECEIVING_TRUSTLINE_MISSING',
    outcome: 'failed',
    retryable: true,
  });
  assert.equal(f.client.lastOperation().outcome, 'failed');
  assert.equal(
    f.state.walletCalls.some((call) => call.name === 'signTransaction'),
    false,
  );
  ready = true;
  await f.client.command('reserve', { orderId: '0' });
  assert.equal(f.state.commands, 2, 'Only an explicit second user request retries');
});

test('host deployment change after a returned signature remains unknown and is never marked retryable', async () => {
  let signed = false;
  const f = fixture({
    deployment: mainnetDeployment(),
    wallet: {
      signTransaction: async () => {
        signed = true;
        return { signedTxXdr: SIGNED, signerAddress: ACCOUNT };
      },
    },
    job: ({ walletRequest }) => walletRequest(),
    intercept: ({ path, response }) =>
      signed && path === '/api/view' ? response({ error: 'DEPLOYMENT_CHANGED' }, 409) : undefined,
  });
  await f.client.authenticate();
  await assert.rejects(f.client.command('reserve', { orderId: '0' }), {
    code: 'DEPLOYMENT_CHANGED',
    outcome: 'unknown',
    retryable: false,
  });
  assert.equal(
    f.state.replies.some((reply) => reply.result === SIGNED),
    false,
  );
});

test('a wrong wallet network is rejected before requesting account access or a signature', async () => {
  const f = fixture({ deployment: mainnetDeployment() });
  f.state.network = TESTNET_PASSPHRASE;
  await assert.rejects(f.client.authenticate(), {
    code: 'WALLET_NETWORK_CHANGED',
    outcome: 'not-submitted',
  });
  assert.deepEqual(
    f.state.walletCalls.map((call) => call.name),
    ['getNetworkDetails'],
  );
});

test('unavailable chain or deployment prevents all prompts while unavailable payment proof permits authentication', async () => {
  for (const reason of [
    'CHAIN_UNAVAILABLE',
    'DEPLOYMENT_UNAVAILABLE',
    'PAYMENT_VERIFICATION_UNAVAILABLE',
  ]) {
    const f = fixture({
      deployment: mainnetDeployment(),
      intercept: ({ path, response, state }) =>
        path === '/api/view'
          ? response({
              configured: true,
              deployment: state.deployment,
              unavailableReasons: [reason],
            })
          : undefined,
    });
    if (reason === 'PAYMENT_VERIFICATION_UNAVAILABLE')
      assert.equal((await f.client.authenticate()).network, 'mainnet');
    else {
      await assert.rejects(f.client.authenticate(), {
        code: 'CLIENT_CHAIN_UNAVAILABLE',
        outcome: 'not-submitted',
      });
      assert.deepEqual(f.state.walletCalls, []);
    }
  }
});

test('chain unavailability reported after signing keeps the operation unknown and discards its signature', async () => {
  let signed = false;
  const f = fixture({
    deployment: mainnetDeployment(),
    wallet: {
      signTransaction: async () => {
        signed = true;
        return { signedTxXdr: SIGNED, signerAddress: ACCOUNT };
      },
    },
    job: ({ walletRequest }) => walletRequest(),
    intercept: ({ path, response, state }) =>
      path === '/api/view'
        ? response({
            configured: true,
            deployment: state.deployment,
            unavailableReasons: signed ? ['CHAIN_UNAVAILABLE'] : [],
          })
        : undefined,
  });
  await f.client.authenticate();
  await assert.rejects(f.client.command('reserve', { orderId: '0' }), {
    code: 'CLIENT_CHAIN_UNAVAILABLE',
    outcome: 'unknown',
    retryable: false,
  });
  assert.equal(
    f.state.replies.some((reply) => reply.result === SIGNED),
    false,
  );
});
