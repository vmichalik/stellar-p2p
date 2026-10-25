# Run Pactlane

## App and integrated checks

Use Node.js 22.13 or later. From the repo root:

```sh
npm ci --ignore-scripts
npm run dev:app
```

This is the synthetic buyer/seller demo. It makes no bank or chain request. Its loopback URL works only on the execution host. A hosted app or authorized private route is a separate handoff.

For policy, protocol and wallet/RPC checks, run `npm run setup:integration`, prepare the TLS assets below, then run `npm run test:all`. The compiled-WASM rehearsal needs a compatible Rust toolchain: `npm run rehearse:local`. See [integration](../integration/README.md) for rebuilds and service gaps. The checked host used Node 26.7.0, Rust 1.99.1 and Stellar CLI 28.1.0.

## Live browser and host

Run `npm run dev:live` after integration dependencies are prepared. This serves a separate live entry point at loopback port 17861, initially unconfigured with wallet/transaction actions disabled. It does not deploy, submit, or resume bank tests. A trusted local operator module can supply approved configuration through `PACTLANE_HOST_MODULE`; see [the live service handoff](release/live-services.md). No configuration or private files are served to the browser. A remote device still needs an authorized reachable route.

## TLS source and local verification

The imported cloud/proof source is documented in [the proof handoff](proof-handoff.md). Importing it does not deploy the combined app or change the existing service. **Bank tests remain paused** pending the owner's decision to resume and normal per-attempt consent/disclosure review. The local preparation and synthetic checks below do not require a bank request.

A release check must exercise the shipped runtimes rather than skip missing assets. `setup:integration` installs nested package dependencies only. The TLS cases additionally need:

- `.toolchain/tlsn-extension-0.1.0.1501.zip`, prepared and hash-checked by `prepare:tlsn`.
- `.private/extension-setup60/audit.json` and its generated extension/package, prepared offline by `prepare:extension-setup60`.
- `.private/benchmark-stage/benchmark/` with pinned JS, WASM and spawn assets, prepared by `prepare:benchmark` with explicit app/origin arguments below.

After preparation, run `npm run test:all` (which includes the Python benchmark-preparation suite) and `npm run check`, and require zero skipped runtime tests. Gateway tests open synthetic loopback listeners; the host must permit them. This does not repeat a historical public proof or establish payment evidence. Native/compiled-WASM escrow suites and `npm run rehearse:local` remain separate integration gates.

## Private proof service runbook

The following commands reproduce the packaged private launcher. They do not manage the current Fly deployment and should not be used to restart or replace it. Current owner browser: MacBook Pro; the verifier/build host is the Mac mini. Devices do not share loopback addresses or browser profiles.

## Prepare TLSNotary

The browser flow needs TLSNotary extension `0.1.0.1501` and the verifier from source commit `68bbd380d6e1a89d79748e5294661c752f5d1205`. That source uses TLSNotary `0.1.0-alpha.15`. Read the [official quickstart](https://tlsnotary.org/docs/quick_start/browser_extension/) and [verifier docs](https://tlsnotary.org/docs/extension/verifier/).

You need Python 3 and a Rust/Cargo toolchain compatible with the pinned upstream workspace. The tested build host is Apple Silicon macOS with Rust 1.99.1; a Windows verifier build has not been checked. The current browser client is Chrome on the owner's MacBook Pro. Its public extension check passed on 25 October 2026. Downloads and build output stay in ignored `.toolchain/`.

```sh
npm run prepare:tlsn
cargo build --release --locked \
  --manifest-path .toolchain/tlsn-extension-68bbd380d6e1/servers/Cargo.toml \
  -p tlsn-verifier-server
```

Preparation checks the source archive, released extension zip and three runtime assets against pinned SHA-256 hashes. It applies the included patch to bind the verifier to loopback and restrict the target host. It also creates `.private/tlsn/runtime/config.yaml` with webhooks disabled. It does not start a service or install an extension.

To reuse downloaded archives without network access, run `python3 scripts/prepare-tlsn.py --offline`. Existing extracted source is preserved; inspect local modifications before rebuilding it.

## Start the verifier

From the repo root, in a separate terminal:

```sh
cd .private/tlsn/runtime
PORT=17847 TLSN_ALLOWED_HOSTS=app.revolut.com \
  GIT_HASH=68bbd380d6e1a89d79748e5294661c752f5d1205 \
  ../../../.toolchain/tlsn-extension-68bbd380d6e1/servers/target/release/tlsn-verifier-server \
  > verifier.log 2>&1
```

The verifier reads `config.yaml` from its working directory. Leave raw proof storage and webhooks disabled for the diagnostics. Treat any verifier logs from later authenticated runs as private.

## Start the gateway

Copy `.env.example` to `.env`. Set `TLSN_PUBLIC_ORIGIN` to the exact private HTTPS origin your browser will use, including its port. It must have no path, query or trailing slash.

```sh
cp .env.example .env
# Edit .env, then:
npm start
```

The gateway listens on `127.0.0.1:17848` by default and forwards only the supported routes to `127.0.0.1:17847`.

Put a private HTTPS reverse proxy in front of the gateway, with WebSocket upgrades enabled. The browser device must be able to reach that route. If using Tailscale, configure only a dedicated Serve port and keep it inside the tailnet; do not enable Funnel or replace unrelated routes. Verify `/health` returns `ok` and `/info` reports the pinned git hash and TLSNotary version.

These local start commands do not provision a proxy or service manager. The optional public-host staging files are described below; preparation does not deploy them. A remote host’s `localhost` is reachable only on that host.

## Check the public flow first

1. Install the pinned official extension on the actual browser device.
2. Open `/extension-check/` at your configured private origin.
3. Review the extension permissions and use per-disclosure approval.
4. In its control window, run the fixed public request.
5. Review disclosure of the public `GET /robots.txt` request line and HTTP status.

A successful callback is `PUBLIC_PROOF_COMPLETED`. Confirm acceptance in the verifier’s private log as well. This check uses no bank cookies and leaves the release gate at `NOT_CLEARED`.

If setup stalls, `/setup-check/` measures MPC setup in an ordinary browser worker. It uploads about 76 MB and makes no bank request. `/connection-check` is a bounded 1 MiB synthetic upload used by the launcher. These diagnostics answer different questions from an extension proof.

## Authenticated transfer checks — paused

This section is a reference for a later owner-resumed attempt, not an instruction to retry now. The account owner must first decide to resume bank tests, then approve the verifier and exact disclosure for each attempt. Use an existing outgoing transfer; generating a proof does not require sending a new payment.

Open `/`, run the transfer test, and navigate to that transfer inside the extension’s Revolut window. Wait for the individual-detail request. Use **Check response only** to establish HTTP status and response structure before changing the provisional payment selectors.

The full field test requests amount, currency, recipient code, transaction ID, state, completion time and type, plus the request line, response status and Date header. Those fields go to the verifier even though the launcher displays only presence booleans. Request headers stay undisclosed in the extension protocol.

The launcher cannot authorize a claim or release funds. The integrated server-side policy exists, but its live normalizer deliberately rejects unverified payment semantics. Stop at a missing field or failed proof; keep raw bank material out of chat, screenshots and Git.

## Public bank-free diagnostic and host comparison

The [cloud check](https://stellar-p2p-proof-vijay.fly.dev/benchmark/) was deployed and checked by the proof workstream; current availability has not been rechecked during source intake. It runs without an extension, bank login or VPN client. It performs synthetic MPC setup only and uploads about 76 MB. The diagnostic waits up to 90 seconds while reporting the 30-second and 60-second extension deadlines separately.

The owner already completed six alternating comparison trials; results are in [the proof handoff](proof-handoff.md#completed-bank-free-comparison). If a later device/runtime/route change warrants a new bank-free comparison, expand Details and run it from the same foreground browser tab and network. The mini route must be reachable for its trials. The sequence uses about 456 MB and includes same-host cooldowns for the verifier's abandoned-session deadline. Export or report the sanitized summary; keep raw transport data out of the repo.

The reproducible staging command requires explicit operator-selected origins:

```sh
python3 scripts/prepare-proof-benchmark.py \
  --app YOUR_FLY_APP \
  --mini-origin https://your-private-mini-origin
```

Use the operator-selected app/origin for a real staging handoff. A local-only test stage may use `--app pactlane-offline-check --mini-origin https://mini.example.test`; those values are configuration fixtures, not deployment targets. Add `--offline` to reuse checksum-verified archives already present under `.private/benchmark-downloads`.

The helper checks pinned public downloads and stages the source, runtime assets, gateway and Fly configuration under ignored `.private/benchmark-stage`. It starts and deploys nothing. Review the staged configuration before an authorized deployment. The public deployment uses HTTPS/WSS, a fixed target, bounded admission, a server-side registration-budget cap and no webhooks. These are prototype resource bounds, not a completed payment policy.

The separate [cloud response-only page](https://stellar-p2p-proof-vijay.fly.dev/response-check/) is an authenticated diagnostic and remains subject to the bank-test pause. Only after deciding to resume, the account owner must review the displayed verifier, approve the checkbox and review the extension's own permission/disclosure prompts. Open one existing outgoing transfer and use **Check response only**. The page consumes consent after each extension execution and requires fresh approval for another attempt.

This diagnostic discloses the transfer request path including its transaction ID, HTTP status, Content-Type, JSON root marker and selected field names. It does not select cookie/authorization values or financial field values for disclosure. Its rendered plugin rejects payment-field mode before proof setup. Paste only the sanitized `Response check:` line when reporting the result. A successful shape check still leaves `NOT_CLEARED`.

## Prepare the offline 60-second extension regression fixture

After the pinned release archive is present in `.toolchain/`, run:

```sh
npm run prepare:extension-setup60
node --test tlsn/extension-setup60.test.mjs
```

The preparer works offline and writes only to ignored `.private/extension-setup60`; existing output is preserved. The extension's displayed name/version label identifies the local variant. Only the setup watchdog and its matching messages change to 60 seconds; all WASM, permissions and other deadlines stay identical. This is a local diagnostic repack of the official release, not an official release or full source rebuild.

Preparing this fixture for local tests does not require installing it. The owner previously requested the variant, but its installation on the MacBook has not been verified. Any later owner-directed browser test uses Chrome's supported unpacked-extension flow, with the store copy disabled for that test and launcher pages reloaded. Permission and disclosure prompts still apply; this does not resume bank tests. The numeric API version remains compatible, so a numeric version check alone cannot identify this local variant.

## Optional developer diagnostics

`tlsn/browser-setup-smoke.mjs` uses an isolated Playwright browser. Install Playwright in your own development environment, set `TLSN_PUBLIC_ORIGIN`, and optionally set `TLSN_CHROME_EXECUTABLE` to an existing supported Chrome binary. Its default is setup only. `TLSN_SMOKE_PUBLIC_GET=1` opts into the fixed public robots request; it never authenticates an account.

`tlsn/setup-smoke.rs` is a native setup-only example for the pinned upstream verifier workspace. Copy it to `servers/verifier/examples/setup_smoke.rs` within the downloaded source, set `TLSN_VERIFIER_HOST` and `TLSN_VERIFIER_PORT`, then run the Cargo example. It closes before sending a bank request.

These optional diagnostics are development tools, not part of the normal user flow.

## Formatting

Run `npm ci --ignore-scripts` to install the pinned development formatter, then use `npm run format:check` or `npm run format`. Rust and Python files are outside Prettier’s scope.
