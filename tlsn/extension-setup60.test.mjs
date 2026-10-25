import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ARCHIVE = process.env.TLSN_SETUP60_ARCHIVE
  ? resolve(process.env.TLSN_SETUP60_ARCHIVE)
  : resolve(ROOT, '.toolchain/tlsn-extension-0.1.0.1501.zip');
const OUTPUT = process.env.TLSN_SETUP60_OUTPUT
  ? resolve(process.env.TLSN_SETUP60_OUTPUT)
  : resolve(ROOT, '.private/extension-setup60');
const ORIGINAL_SHA256 = '1c312ad4305653b8d9351cf3eac46de4222a43be513260bf53053cfa1de45155';
const WORKER = '399.bundle.js';
const PACKAGE = 'tlsnotary-0.1.0.1501-setup60s-local.zip';
const originalPath = 'official';
const patchedPath = 'patched';
const codes = new Map();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function preparedWorkers() {
  if (!(await exists(ARCHIVE)))
    return 'Pinned release archive unavailable; prepare tooling and run scripts/prepare-extension-setup60.py offline first.';
  const bytes = await readFile(ARCHIVE);
  assert.equal(hash(bytes), ORIGINAL_SHA256, 'Pinned extension archive checksum mismatch');
  if (!(await exists(resolve(OUTPUT, 'audit.json'))))
    return '60-second diagnostic extension not prepared; run python3 scripts/prepare-extension-setup60.py.';
  // Python is already the preparation tool. Feed the verified bytes on stdin so
  // extraction cannot race a changed archive path, and never store a large worker fixture in Git.
  const metadata = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        "import hashlib,io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({'worker':z.read('399.bundle.js').decode(),'manifest':json.loads(z.read('manifest.json')),'files':[{'name':n,'sha256':hashlib.sha256(z.read(n)).hexdigest()} for n in z.namelist() if not n.endswith('/')]}))",
      ],
      { input: bytes, encoding: 'utf8', maxBuffer: 1024 * 1024 },
    ),
  );
  const audit = JSON.parse(await readFile(resolve(OUTPUT, 'audit.json'), 'utf8'));
  assert.equal(audit.originalSha256, ORIGINAL_SHA256);
  assert.equal(audit.setupTimeoutMs, 60000);
  assert.deepEqual(audit.modifiedFiles.map((row) => row.path).sort(), [WORKER, 'manifest.json']);
  assert.equal(audit.cryptographicRuntimeChanged, false);
  assert.equal(audit.permissionsChanged, false);
  const originalCode = metadata.worker;
  let expected = originalCode;
  for (const [before, after] of [
    ['const g=3e4;', 'const g=6e4;'],
    ['setupProver timed out after 30000ms', 'setupProver timed out after 60000ms'],
    ['setupProverRelay timed out after 30000ms', 'setupProverRelay timed out after 60000ms'],
  ]) {
    assert.equal(expected.split(before).length - 1, 1, 'Pinned worker layout changed');
    expected = expected.replace(before, after);
  }
  const extension = resolve(OUTPUT, 'extension');
  const patchedCode = await readFile(resolve(extension, WORKER), 'utf8');
  assert.equal(patchedCode, expected, 'Worker differs beyond the three approved timeout edits');
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.0.1501');
  assert.equal(manifest.name, 'TLSNotary (local setup 60s)');
  assert.equal(manifest.version_name, '0.1.0.1501-setup60s-local');
  const restored = { ...manifest };
  delete restored.version_name;
  restored.name = metadata.manifest.name;
  assert.deepEqual(restored, metadata.manifest, 'Manifest changed beyond local name/version label');
  const entries = await readdir(extension, { withFileTypes: true, recursive: true });
  assert.ok(
    entries.every((entry) => entry.isFile() || entry.isDirectory()),
    'Unexpected extension link or special file',
  );
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      resolve(entry.parentPath, entry.name)
        .slice(extension.length + 1)
        .replaceAll('\\', '/'),
    )
    .sort();
  assert.deepEqual(
    fileNames,
    metadata.files.map((row) => row.name).sort(),
    'Unexpected extension file set',
  );
  for (const file of metadata.files) {
    if (![WORKER, 'manifest.json'].includes(file.name))
      assert.equal(
        hash(await readFile(resolve(extension, file.name))),
        file.sha256,
        'Unrelated release asset changed: ' + file.name,
      );
  }
  assert.equal(audit.packageFile, PACKAGE);
  assert.equal(
    hash(await readFile(resolve(OUTPUT, PACKAGE))),
    audit.packageSha256,
    'Prepared package checksum mismatch',
  );
  codes.set('official', originalCode);
  codes.set('patched', patchedCode);
  return false;
}

const skip = await preparedWorkers();

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

// Execute the actual released/patched webpack entry. Only its Comlink/WASM
// imports, transport, and clock are replaced; setup/sendRequest code is intact.
async function harness(workerPath, { setupDelay = Infinity, requestDelay = Infinity } = {}) {
  const code = codes.get(workerPath);
  assert.equal(typeof code, 'string', 'Prepared worker unavailable');
  let now = 0;
  let nextTimer = 0;
  let api;
  const timers = new Map();
  const sockets = [];
  const calls = { setup: 0, sendRequest: 0 };

  function schedule(fn, delay = 0) {
    const id = nextTimer++;
    timers.set(id, { at: now + delay, fn });
    return id;
  }

  class FakeProver {
    set_progress_callback() {}
    setup() {
      calls.setup++;
      return new Promise((resolve) => {
        if (Number.isFinite(setupDelay)) schedule(resolve, setupDelay);
      });
    }
    send_request() {
      calls.sendRequest++;
      return new Promise((resolve) => {
        if (Number.isFinite(requestDelay)) schedule(resolve, requestDelay);
      });
    }
  }

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.closed = false;
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send() {}
    close() {
      this.closed = true;
      this.onclose?.({});
    }
  }

  const self = { location: 'https://fixture.invalid/399.bundle.js', postMessage() {} };
  const context = vm.createContext({
    self,
    navigator: { hardwareConcurrency: 8 },
    console: { log() {}, debug() {}, info() {}, error() {} },
    WebSocket: FakeWebSocket,
    setTimeout: schedule,
    importScripts(name) {
      assert.equal(name, '/71.bundle.js');
      self.webpackChunkextension.push([
        [71],
        {
          7695(module) {
            module.exports = {
              p(value) {
                api = value;
              },
            };
          },
          1797(module) {
            module.exports = { default: async () => {}, n_: async () => {}, Xj: FakeProver };
          },
        },
      ]);
    },
  });
  vm.runInContext(code, context, { timeout: 1000 });
  await flush();
  assert.equal(typeof api?.setupProver, 'function');
  const proverId = await api.createProver({});

  async function advance(target) {
    assert.ok(target >= now);
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.at;
      timer.fn();
      await flush();
    }
    now = target;
    await flush();
  }

  function observe(promise) {
    const result = { state: 'pending', error: null };
    promise.then(
      () => {
        result.state = 'fulfilled';
      },
      (error) => {
        result.state = 'rejected';
        result.error = error;
      },
    );
    return result;
  }

  return { api, proverId, advance, observe, sockets, calls };
}

for (const [label, path, limit] of [
  ['official', originalPath, 30000],
  ['patched', patchedPath, 60000],
]) {
  test(
    `${label}: direct stalled setup rejects at ${limit}ms and closes socket`,
    { skip },
    async () => {
      const h = await harness(path);
      const result = h.observe(h.api.setupProver(h.proverId, 'wss://fixture.invalid/verifier'));
      await flush();
      await h.advance(limit - 1);
      assert.equal(result.state, 'pending');
      assert.equal(h.sockets[0].closed, false);
      await h.advance(limit);
      assert.equal(result.state, 'rejected');
      assert.match(result.error.message, new RegExp(`setupProver timed out after ${limit}ms`));
      assert.equal(h.sockets[0].closed, true);
      assert.equal(h.calls.setup, 1);
    },
  );

  test(`${label}: relayed stalled setup rejects at ${limit}ms`, { skip }, async () => {
    const h = await harness(path);
    const result = h.observe(h.api.setupProverRelay(h.proverId, () => {}));
    await flush();
    await h.advance(limit - 1);
    assert.equal(result.state, 'pending');
    await h.advance(limit);
    assert.equal(result.state, 'rejected');
    assert.match(result.error.message, new RegExp(`setupProverRelay timed out after ${limit}ms`));
    assert.equal(h.sockets.length, 0);
  });

  test(`${label}: HTTP send watchdog remains 60000ms`, { skip }, async () => {
    const h = await harness(path);
    const result = h.observe(h.api.sendRequest(h.proverId, 'wss://fixture.invalid/proxy', {}));
    await flush();
    await h.advance(59999);
    assert.equal(result.state, 'pending');
    assert.equal(h.sockets[0].closed, false);
    await h.advance(60000);
    assert.equal(result.state, 'rejected');
    assert.match(result.error.message, /sendRequest timed out after 60000ms/);
    assert.equal(h.sockets[0].closed, true);
    assert.equal(h.calls.sendRequest, 1);
  });
}

for (const setupDelay of [36200, 45000]) {
  for (const method of ['setupProver', 'setupProverRelay']) {
    test(
      `patched: ${method} remains pending at 30000ms and accepts ${setupDelay}ms setup`,
      { skip },
      async () => {
        const h = await harness(patchedPath, { setupDelay });
        const argument = method === 'setupProver' ? 'wss://fixture.invalid/verifier' : () => {};
        const result = h.observe(h.api[method](h.proverId, argument));
        await flush();
        await h.advance(30000);
        assert.equal(result.state, 'pending');
        await h.advance(setupDelay);
        assert.equal(result.state, 'fulfilled');
        if (method === 'setupProver') assert.equal(h.sockets[0].closed, false);
      },
    );
  }
}

test('official: measured 36200ms setup is rejected at 30000ms', { skip }, async () => {
  const h = await harness(originalPath, { setupDelay: 36200 });
  const result = h.observe(h.api.setupProver(h.proverId, 'wss://fixture.invalid/verifier'));
  await flush();
  await h.advance(30000);
  assert.equal(result.state, 'rejected');
  await h.advance(36200);
  assert.equal(result.state, 'rejected');
  assert.equal(h.sockets[0].closed, true);
});
