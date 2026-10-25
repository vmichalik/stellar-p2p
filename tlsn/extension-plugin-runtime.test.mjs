// Offline integration with the released Host, serializer, and QuickJS runtime.
// All captured headers, window events, and proof results below are synthetic.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { readResponseRoute } from './response-check.mjs';

const archiveBytes = await readFile(
  new URL('../.toolchain/tlsn-extension-0.1.0.1501.zip', import.meta.url),
).catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const skip = archiveBytes ? false : 'Prepare the pinned extension archive to exercise its Host.';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let assets;

function releasedAssets() {
  if (assets) return assets;
  assert.equal(
    hash(archiveBytes),
    '1c312ad4305653b8d9351cf3eac46de4222a43be513260bf53053cfa1de45155',
  );
  const entries = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        "import base64,io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in ['offscreen.bundle.js','538e76306708aed6eb39.wasm']}))",
      ],
      { input: archiveBytes, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
    ),
  );
  const bundle = Buffer.from(entries['offscreen.bundle.js'], 'base64');
  const wasmBinary = Buffer.from(entries['538e76306708aed6eb39.wasm'], 'base64');
  assert.equal(hash(bundle), '5f97f38cd68c81abb7b1c76569da4ca5d68b05a4622c10f738e62284e8cd3cc9');
  assert.equal(
    hash(wasmBinary),
    'a5920bb5789c1ad1236c54b0146a2b3a2eb262050e2baea0388bce574a2632bb',
  );
  const code = bundle.toString();
  const startup = 'const Ge=new Worker(new URL(s.p+s.u(399),s.b)),Je=Fe(Ge);';
  assert.equal(code.split(startup).length - 1, 1, 'Pinned proof-worker startup layout changed');
  // Preserve the released Host/evaluator/serializer code verbatim, ending before
  // proof-worker construction and the offscreen React/Chrome startup. Expose only
  // the existing Host, registry, variant loader, and webpack module loader.
  const hostCode =
    code.slice(0, code.indexOf(startup)) +
    'globalThis.__shippedHost={Host:ke,registry:T,update:A,variant:Se,require:s};})()})();';
  assets = { hostCode, wasmBinary };
  return assets;
}

const response = {
  results: [
    { type: 'RECV', part: 'STATUS_CODE', value: '200' },
    { type: 'RECV', part: 'HEADERS', value: 'content-type: application/json' },
    { type: 'RECV', part: 'ALL', value: '\r\n\r\n{' },
    { type: 'RECV', part: 'ALL', value: '"amount":' },
  ],
};

async function until(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

async function harness(headerCount) {
  const { hostCode, wasmBinary } = releasedAssets();
  const timeouts = new Set();
  const intervals = new Set();
  const errors = [];
  let forbiddenCalls = 0;
  const forbidden = () => {
    forbiddenCalls++;
    throw new Error('Network and proof-worker startup are forbidden in this test');
  };
  const sandbox = vm.createContext({
    console: {
      log() {},
      info() {},
      debug() {},
      warn: (...args) => errors.push(args.map(String).join(' ')),
      error: (...args) => errors.push(args.map(String).join(' ')),
    },
    self: { location: { href: 'https://synthetic.invalid/offscreen.html' } },
    // Only the ID is needed by the bundled browser-polyfill environment check.
    chrome: { runtime: { id: 'synthetic-extension' } },
    setTimeout(fn, delay, ...args) {
      const timer = setTimeout(() => {
        timeouts.delete(timer);
        fn(...args);
      }, delay);
      timeouts.add(timer);
      timer.unref();
      return timer;
    },
    clearTimeout(timer) {
      timeouts.delete(timer);
      clearTimeout(timer);
    },
    setInterval(fn, delay, ...args) {
      const timer = setInterval(fn, delay, ...args);
      intervals.add(timer);
      timer.unref();
      return timer;
    },
    clearInterval(timer) {
      intervals.delete(timer);
      clearInterval(timer);
    },
    WebAssembly,
    TextEncoder,
    TextDecoder,
    performance,
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    crypto: webcrypto,
    Worker: forbidden,
    WebSocket: forbidden,
    fetch: forbidden,
  });
  vm.runInContext(hostCode, sandbox);
  const shipped = sandbox.__shippedHost;
  const factory = shipped.require(5691).default;
  shipped.variant.importModuleLoader = async () => (options) => factory({ ...options, wasmBinary });
  const contexts = new Set();
  const Context = shipped.require(7533).QM;
  const original = Context.prototype.newFunction;
  Context.prototype.newFunction = function (...args) {
    contexts.add(this);
    return original.apply(this, args);
  };
  const listeners = new Set();
  const eventEmitter = {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit(message) {
      // The real background routes this notification back to the managed window.
      const routed =
        message.type === 'TO_BG_RE_RENDER_PLUGIN_UI'
          ? { ...message, type: 'RE_RENDER_PLUGIN_UI' }
          : message;
      for (const listener of listeners) listener(routed);
    },
  };
  const proofs = [];
  let finishProof;
  let lastUi;
  const host = new shipped.Host({
    onProve(request, options) {
      proofs.push({ request, options });
      return new Promise((resolve) => {
        finishProof = resolve;
      });
    },
    onRenderPluginUi: (_, ui) => {
      lastUi = ui;
    },
    onOpenWindow: async () => ({
      type: 'WINDOW_OPENED',
      payload: { windowId: 1, tabId: 1, uuid: 'synthetic' },
    }),
    onCloseWindow() {},
    enableTimeout: false,
    logLevel: 3,
  });
  const plugin = String(
    (await readResponseRoute('/response-check/plugin.mjs', 'https://synthetic.invalid')).body,
  );
  let settled = false;
  let executionError;
  const execution = host.executePlugin(plugin, { eventEmitter }).then(
    () => {
      settled = true;
    },
    (error) => {
      executionError = error;
      settled = true;
    },
  );
  await until(() => shipped.registry.size === 1 && lastUi, 'Synthetic Host did not open its UI');
  const [id] = shipped.registry.keys();
  assert.equal(contexts.size, 1);
  const context = [...contexts][0];
  // Construct fixtures in the serializer's realm. The proxy observes the actual
  // captured-array JSON boundary without changing the released hook or plugin.
  sandbox.headerCount = headerCount;
  const headers = vm.runInContext(
    `globalThis.headerSerializations = 0;
     new Proxy(Array.from({ length: headerCount }, (_, i) => ({
       method: 'GET',
       url: 'https://app.revolut.com/api/retail/transaction/00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
       timestamp: i + 1,
       requestHeaders: [
         { name: 'Cookie', value: 'synthetic-cookie' },
         ...Array.from({ length: 7 }, (_, j) => ({ name: 'synthetic-' + j, value: 'fixture-' + j }))
       ]
     })), { get(target, property, receiver) {
       if (property === 'toJSON') globalThis.headerSerializations++;
       return Reflect.get(target, property, receiver);
     } })`,
    sandbox,
  );
  shipped.update(id, { headers });
  shipped.registry.get(id).main();
  const latest = headers[headers.length - 1].url;
  await until(
    () => shipped.registry.get(id)?.stateStore.selected?.url === latest,
    'The latest synthetic transfer was not selected',
  );
  return {
    host,
    proofs,
    latest,
    eventEmitter,
    state: () => shipped.registry.get(id)?.stateStore,
    ui: () => lastUi,
    headerSerializations: () => sandbox.headerSerializations,
    allocations: () => context.fnNextId + 32768,
    runMain() {
      const entry = shipped.registry.get(id);
      assert.ok(entry, executionError?.message ?? 'Synthetic execution ended early');
      entry.main();
    },
    async finish() {
      if (finishProof) finishProof(response);
      else eventEmitter.emit({ type: 'WINDOW_CLOSED', windowId: 1 });
      await until(() => settled, 'Synthetic execution did not settle');
      await execution;
    },
    assertHealthy() {
      assert.equal(
        errors.some((error) => /had no callback|Lifetime not alive|Assertion failed/.test(error)),
        false,
        'Released runtime failed while processing synthetic fixtures: ' +
          errors.slice(0, 3).join('; '),
      );
    },
    dispose() {
      for (const timer of timeouts) clearTimeout(timer);
      for (const timer of intervals) clearInterval(timer);
      listeners.clear();
      assert.equal(forbiddenCalls, 0, 'Unexpected worker/network startup');
      // The shipped library can assert in JS_FreeRuntime during synthetic Host
      // disposal even below the callback limit. Assert operation health before
      // finish(); this app-level regression does not claim to fix SDK disposal.
    },
  };
}

test(
  'actual plugin preserves latest transfer selection with bounded shipped-host callback growth',
  { skip },
  async (t) => {
    const growth = [];
    for (const count of [1, 20]) {
      const h = await harness(count);
      try {
        assert.equal(h.proofs.length, 0, 'Header capture must never start a proof');
        const before = h.allocations();
        for (let run = 0; run < 80; run++) h.runMain();
        const delta = h.allocations() - before;
        growth.push(delta);
        t.diagnostic(`${count} captured transfer(s): ${delta / 80} callback allocations per main`);
        assert.ok(
          delta <= 80 * 120,
          'Repeated selection approaches the released callback-ID limit',
        );
        assert.equal(h.state().selected.url, h.latest);
        assert.equal(h.proofs.length, 0);
        assert.doesNotMatch(JSON.stringify(h.ui()), /synthetic-cookie|fixture-/);
        h.assertHealthy();
      } finally {
        try {
          await h.finish();
        } finally {
          h.dispose();
        }
      }
    }
    assert.ok(Math.abs(growth[1] - growth[0]) <= 80 * 10, 'History size increases callback growth');
  },
);

test(
  'pending actual plugin skips captured-header serialization while preserving explicit disclosure consent',
  { skip },
  async (t) => {
    for (const count of [1, 20]) {
      const h = await harness(count);
      try {
        assert.equal(h.proofs.length, 0);
        h.eventEmitter.emit({ type: 'PLUGIN_UI_CLICK', onclick: 'checkResponse', windowId: 1 });
        await until(
          () => h.proofs.length === 1 && h.state()?.pending,
          'Explicit synthetic proof did not start',
        );
        assert.equal(h.proofs[0].request.url, h.latest);
        assert.equal(h.proofs[0].options.maxSentData, 4096);
        assert.equal(h.proofs[0].options.maxRecvData, 16384);
        const before = h.allocations();
        const headerReads = h.headerSerializations();
        for (let run = 0; run < 100; run++) h.runMain();
        t.diagnostic(
          `${count} captured transfer(s), pending: ${(h.allocations() - before) / 100} callback allocations per main`,
        );
        assert.equal(
          h.headerSerializations(),
          headerReads,
          'Pending rendering copied captured headers',
        );
        assert.ok(h.allocations() - before <= 100 * 16, 'Pending rendering exhausts callback IDs');
        assert.equal(h.state().selected.url, h.latest);
        let approved = false;
        let rejected = false;
        h.host.registerRevealApproval(
          () => {
            approved = true;
          },
          () => {
            rejected = true;
          },
          [],
        );
        await until(
          () =>
            JSON.stringify(h.ui()).includes('_revealApprove') &&
            JSON.stringify(h.ui()).includes('_revealReject'),
          'Pending UI suppressed the released disclosure-approval overlay',
        );
        assert.equal(approved, false);
        assert.equal(rejected, false);
        assert.equal(h.proofs.length, 1, 'Rendering or approval started another proof');
        h.eventEmitter.emit({ type: 'PLUGIN_UI_CLICK', onclick: '_revealApprove', windowId: 1 });
        await until(() => approved, 'Explicit approval did not reach the pending disclosure');
        assert.equal(rejected, false);
        h.host.registerRevealApproval(
          () => {
            approved = true;
          },
          () => {
            rejected = true;
          },
          [],
        );
        h.eventEmitter.emit({ type: 'PLUGIN_UI_CLICK', onclick: '_revealReject', windowId: 1 });
        await until(() => rejected, 'Explicit rejection did not reach the pending disclosure');
        assert.equal(h.proofs.length, 1);
        h.assertHealthy();
      } finally {
        try {
          await h.finish();
        } finally {
          h.dispose();
        }
      }
    }
  },
);
