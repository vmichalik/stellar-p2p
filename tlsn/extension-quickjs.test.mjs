// Offline reproduction of an observed error, not a fix or a live proof test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const archive = new URL('../.toolchain/tlsn-extension-0.1.0.1501.zip', import.meta.url);
const archiveBytes = await readFile(archive).catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test(
  'released QuickJS callback IDs overflow at allocation 65536 and then alias an earlier callback',
  {
    skip: archiveBytes
      ? false
      : 'Prepare the pinned extension archive to exercise shipped QuickJS.',
  },
  async () => {
    assert.equal(
      sha256(archiveBytes),
      '1c312ad4305653b8d9351cf3eac46de4222a43be513260bf53053cfa1de45155',
    );
    // Read exactly two assets from the verified archive; no files are extracted or installed.
    const assets = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          "import base64,io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in ['offscreen.bundle.js','538e76306708aed6eb39.wasm']}))",
        ],
        { input: archiveBytes, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
      ),
    );
    const bundle = Buffer.from(assets['offscreen.bundle.js'], 'base64');
    const wasmBinary = Buffer.from(assets['538e76306708aed6eb39.wasm'], 'base64');
    assert.equal(
      sha256(bundle),
      '5f97f38cd68c81abb7b1c76569da4ca5d68b05a4622c10f738e62284e8cd3cc9',
    );
    assert.equal(
      sha256(wasmBinary),
      'a5920bb5789c1ad1236c54b0146a2b3a2eb262050e2baea0388bce574a2632bb',
    );

    // Retain the released module loader and implementations; remove only the
    // extension's startup entry. This sandbox has no Chrome, fetch or WebSocket API.
    const code = bundle.toString();
    const startup = '(()=>{"use strict";var e,t=s(4848),n=s(6540),r=s(5338),i=s(222),o=s.n(i);';
    assert.equal(code.split(startup).length - 1, 1, 'Pinned bundle layout changed');
    const loader = code.slice(0, code.indexOf(startup)) + 'globalThis.__webpack=s})();';
    const errors = [];
    const silentConsole = {
      log() {},
      warn() {},
      error: (...args) => errors.push(args.map(String).join(' ')),
    };
    const sandbox = vm.createContext({
      console: silentConsole,
      self: { location: { href: 'https://synthetic.invalid/offscreen.html' } },
      setTimeout,
      clearTimeout,
      WebAssembly,
      TextEncoder,
      TextDecoder,
      performance,
      URL,
    });
    vm.runInContext(loader, sandbox);
    const requireModule = sandbox.__webpack;
    const emscripten = await requireModule(5691).default({
      wasmBinary,
      print() {},
      printErr: (message) => errors.push(String(message)),
    });
    const { QuickJSFFI } = requireModule(8591);
    const QuickJSWASMModule = requireModule(7533).r6;
    const context = new QuickJSWASMModule(emscripten, new QuickJSFFI(emscripten)).newContext();
    const samples = [];
    try {
      for (let allocation = 1; allocation <= 65_537; allocation++) {
        const fn = context.newFunction('synthetic', () => context.newNumber(allocation));
        try {
          if ([1, 65_535, 65_536, 65_537].includes(allocation)) {
            context.setProp(context.global, 'synthetic', fn);
            const result = context.evalCode('synthetic()');
            try {
              assert.equal(result.error, undefined);
              samples.push([allocation, context.fnNextId, context.dump(result.value)]);
            } finally {
              (result.error ?? result.value).dispose();
            }
          }
        } finally {
          fn.dispose();
        }
      }
    } finally {
      context.dispose();
    }
    assert.deepEqual(samples, [
      [1, -32767, 1],
      [65_535, 32767, 65_535],
      [65_536, 32768, undefined],
      [65_537, 32769, 1],
    ]);
    assert.deepEqual(errors, [
      '[C to host error: returning null] Error: QuickJSContext had no callback with id -32768',
    ]);
  },
);
