import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createHostClient, TESTNET_PASSPHRASE } from './host-client.mjs';

// Shape-only disposable identities/signatures. The host bridge's separate
// tests perform actual SDK signature verification; these test browser transport.
const ACCOUNT = 'G' + 'A'.repeat(55),
  OTHER = 'G' + 'B'.repeat(55);
const ID = 'o'.repeat(43),
  CHALLENGE = 'c'.repeat(43),
  REQUEST = 'r'.repeat(43);
const SIGNATURE = new Uint8Array(64).fill(17);
const UNSIGNED = btoa('synthetic unsigned transaction');
const SIGNED = btoa('synthetic signed transaction');

function fixture(options = {}) {
  const state = {
    now: 1_000,
    authenticated: false,
    account: ACCOUNT,
    network: TESTNET_PASSPHRASE,
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
  const info = () => ({
    account: ACCOUNT,
    networkPassphrase: TESTNET_PASSPHRASE,
    expiresAt: state.now + 60_000,
  });
  const walletRequest = (
    method = 'sign',
    args = { transactionXdr: UNSIGNED, account: ACCOUNT, networkPassphrase: TESTNET_PASSPHRASE },
    id = REQUEST,
  ) => ({ operationId: ID, status: 'running', walletRequest: { id, method, args } });
  const walletMethods = {
    requestAccess: async () => ({ address: state.account }),
    getAddress: async () => ({ address: state.account }),
    getNetworkDetails: async () => ({ networkPassphrase: state.network }),
    signMessage: async () => ({ signedMessage: SIGNATURE, signerAddress: state.account }),
    signTransaction: async () => ({ signedTxXdr: SIGNED, signerAddress: state.account }),
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
        networkPassphrase: TESTNET_PASSPHRASE,
        message: `Pactlane wallet session\nOrigin: ${location.origin}\nNetwork: ${TESTNET_PASSPHRASE}\nAccount: ${body.account}\nNonce: ${CHALLENGE}\nExpires: ${expiresAt}\nThis authenticates this browser session only. It does not authorize a transaction.`,
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
    if (path === '/api/view') return response({ orders: [], available: false });
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
  assert.deepEqual(await f.client.view(), { orders: [], available: false });
  await f.client.logout();
  assert.equal(await f.client.session(), null);
});

test('refuses a tampered challenge before opening a message-signing prompt', async () => {
  const f = fixture({
    intercept: ({ path, response, state }) =>
      path === '/api/session/challenge'
        ? response({
            challengeId: CHALLENGE,
            expiresAt: state.now + 60_000,
            networkPassphrase: TESTNET_PASSPHRASE,
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
  assert.throws(() => f.client.command('resolve', { orderId: '7' }), {
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
