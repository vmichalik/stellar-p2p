import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const check = (v) => {
  if (!v) throw Error('WALLET_CONFIGURATION_INVALID');
};
export function walletConfiguration({ projectId = '', appUrl, publicOrigin }) {
  check(typeof projectId === 'string' && (projectId === '' || /^[a-f0-9]{32}$/i.test(projectId)));
  const parsed = new URL(appUrl ?? publicOrigin);
  check(
    parsed.origin === publicOrigin &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      parsed.pathname === '/',
  );
  check(
    parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)),
  );
  return Object.freeze({ enabled: Boolean(projectId), projectId, appUrl: parsed.origin });
}
export async function walletBundle() {
  for (const [pkg, version] of [
    ['@walletconnect/universal-provider', '2.26.0'],
    ['qrcode', '1.5.4'],
    ['esbuild', '0.28.2'],
  ]) {
    const installed = JSON.parse(
      await readFile(new URL(`node_modules/${pkg}/package.json`, import.meta.url), 'utf8'),
    );
    check(installed.version === version);
  }
  const result = await build({
    entryPoints: [new URL('./wallet-vendor-entry.mjs', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'eof',
  });
  return result.outputFiles[0].contents;
}
