import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../../deploy/demo/worker.mjs';
import { SECURITY_HEADERS, STATIC_HEADERS } from '../../deploy/demo/headers.mjs';

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

test('same-origin playback is allowed only for the present exact MP4 asset', async () => {
  for (const [path, status, enabled] of [
    ['/demo.mp4', 200, true],
    ['/demo.mp4', 404, false],
    ['/other.mp4', 200, false],
  ]) {
    const response = await worker.fetch(new Request('https://pactlane.io' + path), {
      ASSETS: {
        fetch: async () =>
          new Response('synthetic media fixture', {
            status,
            headers: { 'Content-Type': 'video/mp4' },
          }),
      },
    });
    assert.equal(
      response.headers.get('Content-Security-Policy').includes("media-src 'self'"),
      enabled,
    );
    assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self'/);
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

test('unconfigured live API fails explicitly and cannot return demo assets', async () => {
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
