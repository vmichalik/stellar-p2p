# Run Pactlane

Use Node.js 22.13 or later. Locked dependency installs keep the app, policy and Stellar SDK versions aligned.

## Browser demo

```sh
npm ci --ignore-scripts
npm run dev:app
```

Open the printed `/?demo=1` URL on the machine running the server. For another device, use [the hosted demo](https://pactlane.io/?demo=1).

Create and fund an offer in Sell USDC, then switch to the buyer view. The settings button controls payment-check outcomes and resets the sample trade.

## Full source checks

```sh
npm run setup:integration
npm run test:all
npm run check
npm run format:check
```

The integration setup installs pinned packages in `policy`, `contracts/escrow/protocol` and `integration`. Native/compiled contract checks also require the compatible Rust toolchain described in the [contract README](../contracts/escrow/README.md).

```sh
npm run rehearse:local
```

This runs the policy against the compiled escrow with test data. It does not require a bank login.

## Live host

```sh
npm run dev:live
```

Configure the environment and server adapters using [integration](../integration/README.md) and the [mainnet runbook](release/mainnet-test.md). The host serves the same mode-aware interface as the website. Wallet and payment actions use the configured network, signer and durable stores.

## Site bundle

```sh
npm run build:demo
npm run check:demo
npm run preview:demo
```

The build uses an explicit public-asset allowlist. Reviewed video files can be included with `--media-dir` as described in [deployment](../deploy/demo/README.md). Generated output is under `dist/demo`.

## Proof tooling

Install [Pactlane TLSNotary](https://github.com/vmichalik/pactlane-tlsnotary) for authenticated proof checks. [Proof setup](../tlsn/README.md) documents the pinned runtime and verifier. Review the requested disclosure in the extension. Keep bank credentials, raw responses and private runtime files outside source control.
