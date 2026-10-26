import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../../deploy/demo/worker.mjs';
import { SECURITY_HEADERS, STATIC_HEADERS } from '../../deploy/demo/headers.mjs';

test('exchange proxy has one fixed upstream, preserves session cookies, and rejects cross-origin writes', async (t) => {
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url: String(url), options };
    return Response.json(
      { configured: false },
      {
        headers: {
          'Set-Cookie': '__Host-pactlane=test; Secure; Path=/; HttpOnly; SameSite=Strict',
        },
      },
    );
  };
  const view = await worker.fetch(
    new Request('https://pactlane.io/api/view', { headers: { cookie: '__Host-pactlane=test' } }),
    {},
  );
  assert.equal(view.status, 200);
  assert.equal(seen.url, 'https://stellar-p2p-proof-vijay.fly.dev/api/view');
  assert.equal(seen.options.headers.get('cookie'), '__Host-pactlane=test');
  assert.match(view.headers.get('set-cookie'), /__Host-pactlane/);
  seen = null;
  assert.equal(
    (
      await worker.fetch(
        new Request('https://pactlane.io/api/command', {
          method: 'POST',
          headers: { origin: 'https://attacker.invalid' },
          body: '{}',
        }),
        {},
      )
    ).status,
    403,
  );
  assert.equal(seen, null);
  assert.equal(
    (
      await worker.fetch(
        new Request('https://pactlane.io/api/view?target=https://attacker.invalid'),
        {},
      )
    ).status,
    403,
  );
  assert.equal(seen, null);
});

const assertSecured = (response) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    assert.equal(response.headers.get(name), value);
};

test('canonical aliases preserve path and query without contacting assets or proof', async () => {
  for (const host of ['www.pactlane.io', 'app.pactlane.io']) {
    const response = await worker.fetch(
      new Request(`https://${host}/trade?ref=a%2Fb&view=receipt`),
      {},
    );
    assert.equal(response.status, 308);
    assert.equal(
      response.headers.get('location'),
      'https://pactlane.io/trade?ref=a%2Fb&view=receipt',
    );
    assertSecured(response);
  }
});

test('apex serves only assets with the same security policy, including misses', async () => {
  for (const status of [200, 404]) {
    let seen;
    const request = new Request('https://pactlane.io/assets/social-preview.png');
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async (value) => {
          seen = value;
          return new Response('synthetic static fixture', { status });
        },
      },
    });
    assert.equal(seen, request);
    assert.equal(response.status, status);
    assertSecured(response);
  }
});

test('unknown hosts and writes fail closed rather than becoming a proxy', async () => {
  assert.equal((await worker.fetch(new Request('https://proof.pactlane.io/'), {})).status, 421);
  const response = await worker.fetch(new Request('https://pactlane.io/', { method: 'POST' }), {});
  assert.equal(response.status, 405);
  assertSecured(response);
});

test('same-origin playback is allowed on the app document and exact MP4 asset', async () => {
  for (const [path, status, type, enabled] of [
    ['/demo.mp4', 200, 'video/mp4', true],
    ['/demo.mp4', 206, 'video/mp4', true],
    ['/demo.mp4', 404, 'video/mp4', false],
    ['/other.mp4', 200, 'video/mp4', false],
    ['/', 200, 'text/html', true],
    ['/?demo=1', 200, 'text/html', true],
    ['/index.html', 200, 'text/html', true],
    ['/', 404, 'text/html', false],
    ['/', 200, 'application/json', false],
  ]) {
    const response = await worker.fetch(new Request('https://pactlane.io' + path), {
      ASSETS: {
        fetch: async () =>
          new Response('synthetic media fixture', {
            status,
            headers: { 'Content-Type': type },
          }),
      },
    });
    assert.equal(
      response.headers.get('Content-Security-Policy').includes("media-src 'self'"),
      enabled,
    );
    assert.ok(
      response.headers
        .get('Content-Security-Policy')
        .includes(path.includes('demo=1') ? "connect-src 'none'" : "connect-src 'self'"),
    );
  }
});

test('deployment disables alternate public URLs and contains only static asset binding', async () => {
  // This comment-free JSONC file permits the formatter's trailing commas.
  const cfg = JSON.parse(
    (await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')).replace(
      /,(\s*[}\]])/g,
      '$1',
    ),
  );
  assert.equal(cfg.name, 'pactlane-demo');
  assert.equal(cfg.workers_dev, false);
  assert.equal(cfg.preview_urls, false);
  assert.equal(cfg.upload_source_maps, false);
  assert.equal(cfg.observability.enabled, false);
  assert.deepEqual(cfg.assets, {
    directory: './dist/demo',
    binding: 'ASSETS',
    run_worker_first: true,
    not_found_handling: 'none',
  });
  assert.deepEqual(
    cfg.routes,
    ['pactlane.io', 'www.pactlane.io', 'app.pactlane.io'].map((pattern) => ({
      pattern,
      custom_domain: true,
    })),
  );
  assert.match(STATIC_HEADERS, /connect-src 'self'/);
  for (const key of [
    'kv_namespaces',
    'd1_databases',
    'r2_buckets',
    'durable_objects',
    'services',
    'triggers',
    'vars',
  ])
    assert.equal(key in cfg, false);
});

test('demo pages block connections and live pages permit only the same origin', async () => {
  for (const [query, allowed] of [
    ['', 'self'],
    ['?demo=1', 'none'],
    ['?demo=0', 'self'],
  ]) {
    const response = await worker.fetch(new Request('https://pactlane.io/' + query), {
      ASSETS: { fetch: async () => new Response('<html>fixture</html>') },
    });
    assert.ok(response.headers.get('Content-Security-Policy').includes(`connect-src '${allowed}'`));
  }
});

test('unavailable live API fails explicitly and cannot return demo assets', async (t) => {
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  globalThis.fetch = async () => {
    throw Error('synthetic unavailable');
  };
  const response = await worker.fetch(new Request('https://pactlane.io/api/view'), {
    ASSETS: {
      fetch() {
        assert.fail('API must not fall through to static demo assets');
      },
    },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'SERVICE_UNAVAILABLE' });
});
