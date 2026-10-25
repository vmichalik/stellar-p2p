import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfiguration, PINNED_GIT_HASH } from './configuration.mjs';
import { renderFlyConfig } from './render-fly-config.mjs';
import { verifierReady } from './start.mjs';

const input = {
  FLY_APP_NAME: 'proof-demo-test',
  TLSN_MINI_ORIGIN: 'https://mini.example.test:9492',
};

test('startup derives the exact public fly.dev origin and fixed upstream/listener ports', () => {
  const config = runtimeConfiguration(input);
  assert.equal(config.publicOrigin, 'https://proof-demo-test.fly.dev');
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 8080);
  assert.equal(config.upstreamPort, 17847);
  assert.deepEqual(config.targets, [
    { id: 'mini', origin: input.TLSN_MINI_ORIGIN },
    { id: 'cloud', origin: config.publicOrigin },
  ]);
});

test('invalid origins and app names fail closed before starting anything', () => {
  for (const name of [
    undefined,
    'UPPERCASE',
    '-bad',
    'bad-',
    'foo.fly.dev',
    'foo/path',
    'foo?token=secret',
    'x'.repeat(64),
  ])
    assert.throws(() => runtimeConfiguration({ ...input, FLY_APP_NAME: name }));
  for (const origin of [
    undefined,
    'http://mini.example.test',
    'https://mini.example.test/',
    'https://user:secret@mini.example.test',
    'https://proof-demo-test.fly.dev',
  ])
    assert.throws(() => runtimeConfiguration({ ...input, TLSN_MINI_ORIGIN: origin }));
});

test('only explicit well-formed operator extension origins can supplement the official store ID', () => {
  assert.deepEqual(runtimeConfiguration(input).extraExtensionOrigins, []);
  const origin = 'chrome-extension://' + 'a'.repeat(32);
  assert.deepEqual(
    runtimeConfiguration({ ...input, TLSN_EXTRA_EXTENSION_ORIGINS: JSON.stringify([origin]) })
      .extraExtensionOrigins,
    [origin],
  );
  for (const value of [
    'null',
    '*',
    '{bad',
    JSON.stringify(['chrome-extension://*']),
    JSON.stringify([origin + '/']),
  ])
    assert.throws(() => runtimeConfiguration({ ...input, TLSN_EXTRA_EXTENSION_ORIGINS: value }));
});

test('Fly config specifies long-lived single-machine intent and only public gateway port', () => {
  const config = renderFlyConfig(input.FLY_APP_NAME, input.TLSN_MINI_ORIGIN);
  assert.match(config, /primary_region = "cdg"/);
  assert.match(config, /auto_stop_machines = "off"/);
  assert.match(config, /min_machines_running = 1/);
  assert.match(config, /internal_port = 8080/);
  assert.match(config, /cpu_kind = "shared"/);
  assert.match(config, /cpus = 2/);
  assert.match(config, /memory = "4gb"/);
  assert.doesNotMatch(config, /17847|Funnel|\[\[services\]\]/);
  assert.throws(() => renderFlyConfig(input.FLY_APP_NAME, input.TLSN_MINI_ORIGIN, 'cdg\"\n[env]'));
});

test('readiness verifies both health and exact source/protocol versions', async () => {
  const urls = [];
  const fixture =
    (gitHash = PINNED_GIT_HASH) =>
    async (url) => {
      urls.push(url);
      return {
        ok: true,
        text: async () => 'ok',
        json: async () => ({ version: '0.1.0', git_hash: gitHash, tlsn_version: '0.1.0-alpha.15' }),
      };
    };
  assert.equal(await verifierReady(fixture()), true);
  assert.equal(await verifierReady(fixture('unexpected')), false);
  assert.equal(
    await verifierReady(async () => {
      throw new Error('private detail');
    }),
    false,
  );
  assert.ok(urls.every((url) => url.startsWith('http://127.0.0.1:17847/')));
});
