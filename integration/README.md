# Wallet and host integration

The Node host connects the browser, wallet, Stellar RPC and payment service. It supports explicit Stellar testnet or mainnet configuration and serves the same mode-aware interface as the public website.

## Run and check

```sh
npm ci --ignore-scripts
npm run setup:integration
npm run test:all
npm run dev:live
```

From the repository root, `setup:integration` installs the locked policy, protocol and integration dependencies. [Setup](../docs/setup.md) also covers the standalone demo and compiled-WASM rehearsal.

## Main modules

| Module                    | Job                                                                |
| ------------------------- | ------------------------------------------------------------------ |
| `live-server.mjs`         | Explicit static-asset routes and authenticated same-origin API.    |
| `host-runtime.mjs`        | Compose configuration, views, private order data and policy ports. |
| `browser-bridge.mjs`      | Authenticate wallet sessions and dispatch scoped actions.          |
| `stellar-rpc-adapter.mjs` | Prepare, validate, submit and reconcile wallet transactions.       |
| `chain-reader.mjs`        | Read a consistent confirmed deployment and order view.             |
| `chain-reconciler.mjs`    | Process events and update replay checkpoints.                      |
| `transaction-journal.mjs` | Retain operation identity across retries and restarts.             |
| `operator.example.mjs`    | Show where server-owned policy and offer adapters enter.           |

Wallet requests carry the exact network and transaction. The server checks the returned envelope and signer before submission. Unknown outcomes retain the transaction hash for reconciliation. Receipts require confirmed identity and matching transfer events.

Mutual recovery collects the seller’s smart-contract authorization and the buyer’s final envelope for the same allocation. The host cannot replace a missing wallet approval.

## Configure a live operator

Provide the reviewed deployment, token, policy signer, fee cap, private recipient and payer bindings, durable transaction/replay stores and trusted evidence reader. The example operator is a configuration guide; replace it with the actual approved server adapters. Payment instructions require a confirmed lock and ready verification service.

[Mainnet runbook](../docs/release/mainnet-test.md) records the small test trade and remaining configuration. [Architecture](../docs/architecture.md) explains the trust and data flow.

## Compiled-WASM rehearsal

```sh
npm run rehearse:local
npm run rehearse:local -- --rebuild
npm run rehearse:local -- --record
```

With the compatible Rust toolchain installed, this executes the actual escrow WASM against the policy and test token, checks payout and rejects replay. It does not fall back to native registration. The separately recorded [testnet run](../evidence/release/testnet-rehearsal-2026-10-25.json) retains its original source hashes and PLTEST receipts.
