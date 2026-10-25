# Run the prototype

## Source checks

Install Node.js 22 or later, then run:

```sh
npm test
npm run check
```

The active code uses Node’s standard library. No npm install, extension or network access is needed for these checks.

## Prepare TLSNotary

The browser flow needs TLSNotary extension `0.1.0.1501` and the verifier from source commit `68bbd380d6e1a89d79748e5294661c752f5d1205`. That source uses TLSNotary `0.1.0-alpha.15`. Read the [official quickstart](https://tlsnotary.org/docs/quick_start/browser_extension/) and [verifier docs](https://tlsnotary.org/docs/extension/verifier/).

You need Python 3 and a Rust/Cargo toolchain compatible with the pinned upstream workspace. The tested build host is Apple Silicon macOS with Rust 1.99.1; a Windows verifier build has not been checked. Chrome on Windows is the browser client under test. Downloads and build output stay in ignored `.toolchain/`.

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

There is no proxy provisioning, deployment or service manager in this repo. A remote host’s `localhost` is reachable only on that host.

## Check the public flow first

1. Install the pinned official extension on the actual browser device.
2. Open `/extension-check/` at your configured private origin.
3. Review the extension permissions and use per-disclosure approval.
4. In its control window, run the fixed public request.
5. Review disclosure of the public `GET /robots.txt` request line and HTTP status.

A successful callback is `PUBLIC_PROOF_COMPLETED`. Confirm acceptance in the verifier’s private log as well. This check uses no bank cookies and leaves the release gate at `NOT_CLEARED`.

If setup stalls, `/setup-check/` measures MPC setup in an ordinary browser worker. It uploads about 76 MB and makes no bank request. `/connection-check` is a bounded 1 MiB synthetic upload used by the launcher. These diagnostics answer different questions from an extension proof.

## Authenticated transfer checks

The account owner must approve the verifier and the exact disclosure. Use an existing outgoing transfer; generating a proof does not require sending a new payment.

Open `/`, run the transfer test, and navigate to that transfer inside the extension’s Revolut window. Wait for the individual-detail request. Use **Check response only** to establish HTTP status and response structure before changing the provisional payment selectors.

The full field test requests amount, currency, recipient code, transaction ID, state, completion time and type, plus the request line, response status and Date header. Those fields go to the verifier even though the launcher displays only presence booleans. Request headers stay undisclosed in the extension protocol.

The launcher cannot authorize a claim or release funds. A server-side payment policy must be implemented separately. Stop at a missing field or failed proof; keep raw bank material out of chat, screenshots and Git.

## Optional developer diagnostics

`tlsn/browser-setup-smoke.mjs` uses an isolated Playwright browser. Install Playwright in your own development environment, set `TLSN_PUBLIC_ORIGIN`, and optionally set `TLSN_CHROME_EXECUTABLE` to an existing supported Chrome binary. Its default is setup only. `TLSN_SMOKE_PUBLIC_GET=1` opts into the fixed public robots request; it never authenticates an account.

`tlsn/setup-smoke.rs` is a native setup-only example for the pinned upstream verifier workspace. Copy it to `servers/verifier/examples/setup_smoke.rs` within the downloaded source, set `TLSN_VERIFIER_HOST` and `TLSN_VERIFIER_PORT`, then run the Cargo example. It closes before sending a bank request.

These optional diagnostics are development tools, not part of the normal user flow.

## Formatting

Run `npm ci` to install the pinned development formatter, then use `npm run format:check` or `npm run format`. Rust and Python files are outside Prettier’s scope.
