# Integration

This folder has a complete local synthetic rehearsal and a testnet wallet/RPC service candidate. Neither automatically sends a bank request or network transaction.

## Install and check

From the root with Node >=22.13:

```sh
npm ci --ignore-scripts
npm run setup:integration
npm run test:all
```

Setup runs locked, script-disabled installs in `policy/`, `contracts/escrow/protocol/` and `integration/`.

## Local compiled-WASM rehearsal

Requires Cargo/Rust compatible with Soroban SDK 29.0.1 and the pinned locks; checked with Rust 1.99.1. It never falls back to native contract registration.

```sh
npm run rehearse:local
# Rebuild with Stellar CLI 28.1.0; require byte-identical output:
npm run rehearse:local -- --rebuild
# Save sanitized evidence:
npm run rehearse:local -- --record
```

The harness creates the app’s €20 / 22 USDC order, funds a local synthetic token, reserves it and confirms `begin_payment` in the compiled escrow. The Node bridge reads that snapshot, checks synthetic evidence through the real policy and disk SQLite, then signs the frozen claim. Rust independently reproduces the digest, submits the signature to WASM and checks a 220,000,000-base-unit payout.

Contract replay, cross-order payment reuse and duplicate UI settlement are rejected. Proof completed after `pay_by` is allowed for a payment made inside the locked interval. The report records hashes, revision, source dirty status, balances and the open live gate. Public fixture seeds must never become deployment keys.

## Wallet/RPC service candidate

`stellar-rpc-adapter.mjs` uses Stellar SDK 17.1.0 and wraps Freighter API 6.0.1 response shapes. It runs on a Node host because it requires disk SQLite. It cannot be imported directly into the static demo.

The host provides:

- Explicit testnet deployment: HTTPS RPC, escrow/token addresses, seven decimals, policy public key and maximum fee in stroops.
- Wallet port: connect, selected address, network and signed envelope. The authenticated browser bridge and `app/host-client.mjs` route these to Freighter; `freighterWalletPort` also defines the direct adapter shape.
- `TransactionJournal` with a private persistent disk path. Atomic reservations precede wallet prompts. Unknown and legacy preparing transactions never expire automatically. Proven preparation failures and explicit wallet refusal retain history and permit a new user-requested attempt; signed/unknown outcomes require reconciliation. Deleting the journal is not recovery.
- Trusted proof/status/authorization ports and source-bound private recipient reader.
- Explicit `submissionEnabled: true` only when network submission is authorized. Default is false.

Funding, reserve, payment lock, signed release, unlocked-expiry refund and receipts are implemented. Network/config checks, fee cap, unchanged envelope and account signature precede submission. Receipts require confirmed transaction identity and matching token events. Unknown submission reuses its journaled hash.

**Implemented Node modules:** authenticated browser transport, consistent chain reader, event reconciliation with atomic replay checkpoints, and buyer-envelope plus seller-Soroban recovery authorization. See [live service continuation](../docs/release/live-services.md) for their APIs and boundaries.

**Live entry point:** `npm run dev:live` composes the host, public view, Freighter client and separate live UI, initially unconfigured. **Missing:** approved private offer/policy composition, accepted TLSNotary normalization and deployment configuration. The live broker routes exact seller authorization to the authenticated seller, followed by the buyer envelope. `resolve()` requires a configured seller authorization port. Tests mock RPC/wallet while using real SDK signing/encoding, loopback HTTP and disk/restart journals.

These are software/configuration gaps. Deployment authorization alone would not finish them. See [testnet handoff](../deploy/testnet/README.md).
