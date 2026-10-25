import { validateTargets } from '../../tlsn/benchmark/core.mjs';

export const PINNED_GIT_HASH = '68bbd380d6e1a89d79748e5294661c752f5d1205';
export const GATEWAY_PORT = 8080;
export const VERIFIER_PORT = 17847;

export function runtimeConfiguration(env) {
  const name = env.FLY_APP_NAME;
  if (typeof name !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name))
    throw new Error('INVALID_FLY_APP_NAME');
  const publicOrigin = `https://${name}.fly.dev`;
  const targets = validateTargets([
    { id: 'mini', origin: env.TLSN_MINI_ORIGIN },
    { id: 'cloud', origin: publicOrigin },
  ]);
  let extraExtensionOrigins;
  try {
    extraExtensionOrigins = JSON.parse(env.TLSN_EXTRA_EXTENSION_ORIGINS ?? '[]');
  } catch {
    throw new Error('INVALID_EXTENSION_ORIGINS');
  }
  if (
    !Array.isArray(extraExtensionOrigins) ||
    extraExtensionOrigins.length > 4 ||
    new Set(extraExtensionOrigins).size !== extraExtensionOrigins.length ||
    extraExtensionOrigins.some(
      (origin) => typeof origin !== 'string' || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin),
    )
  )
    throw new Error('INVALID_EXTENSION_ORIGINS');
  return Object.freeze({
    publicOrigin,
    targets,
    host: '0.0.0.0',
    port: GATEWAY_PORT,
    upstreamPort: VERIFIER_PORT,
    extraExtensionOrigins: Object.freeze(extraExtensionOrigins),
  });
}
