import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeConfiguration } from './configuration.mjs';

export function renderFlyConfig(app, miniOrigin, region = 'cdg', publicOrigin) {
  const config = runtimeConfiguration({
    FLY_APP_NAME: app,
    TLSN_MINI_ORIGIN: miniOrigin,
    TLSN_BENCHMARK_PUBLIC_ORIGIN: publicOrigin,
  });
  if (!/^[a-z]{3}$/.test(region)) throw new Error('INVALID_FLY_REGION');
  return `# One long-lived public diagnostic machine. Deployment is performed separately.
app = ${JSON.stringify(app)}
primary_region = ${JSON.stringify(region)}
kill_signal = "SIGTERM"
kill_timeout = 10

[build]
  dockerfile = "Dockerfile"

[env]
  TLSN_MINI_ORIGIN = ${JSON.stringify(miniOrigin)}
  TLSN_BENCHMARK_PUBLIC_ORIGIN = ${JSON.stringify(config.publicOrigin)}
  NODE_OPTIONS = "--max-old-space-size=256"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1
  [http_service.concurrency]
    type = "connections"
    soft_limit = 10
    hard_limit = 20
  [[http_service.checks]]
    grace_period = "30s"
    interval = "30s"
    timeout = "5s"
    method = "GET"
    path = "/health"

[[vm]]
  cpu_kind = "shared"
  cpus = 2
  memory = "4gb"
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [app, miniOrigin, region, publicOrigin] = process.argv.slice(2);
    process.stdout.write(renderFlyConfig(app, miniOrigin, region, publicOrigin));
  } catch {
    console.error(
      'Provide the Fly app name, mini HTTPS origin, optional region and optional public HTTPS origin.',
    );
    process.exitCode = 1;
  }
}
