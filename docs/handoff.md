# Development handoff

Objective: finish one Revolut-to-Stellar trade from the integrated Pactlane candidate.

Execution host: Mac mini, Apple Silicon macOS. Current owner browser device: MacBook Pro. These devices do not share local files, browser profiles or loopback addresses.

Repository: private [vmichalik/stellar-p2p](https://github.com/vmichalik/stellar-p2p). Integration worktree: `/Users/vijay/Documents/workspace-personal-projects/pactlane-integration`. Branch: `codex/pactlane-integration`. Base: `807412686da2cdad494ee284675dbefc35110257`. Runtime integration commit: `006ab023e4d44600d03f320f220457e5b5545f0e`. Use `git rev-parse HEAD` for the final documentation/evidence commit and `git status --short` for local changes.

Main's dirty proof docs/evidence and coordinator note were preserved. Component owners' worktrees and running proof services were not changed. This branch can be reviewed or merged separately; do not reset main over those changes.

## Resume

1. Read [status](status.md) and [release handoff](release/HANDOFF.md).
2. Run `npm ci --ignore-scripts`, `npm run setup:integration`, `npm run test:all` and `npm run check`.
3. Start the synthetic browser demo with `npm run dev:app`.
4. With compatible Rust available, run `npm run rehearse:local`; it uses the tracked WASM and synthetic evidence, and submits no network transaction.
5. Finish the live software gaps in [integration](../integration/README.md), then prepare the configured, authorized testnet rehearsal.

## Current boundary

App, policy and escrow work together locally. The browser demo is simulated. Live TLSNotary payment ingestion rejects unverified records. No accepted authenticated payment, deployed escrow, network receipt or public app URL is established by this branch.

The Node wallet/RPC service candidate is implemented and unit checked, but browser transport, trusted live readers/indexer and two-wallet recovery collection remain. These need code, not just deployment approval. The current cloud proof runtime needs its own sanitized source handoff; do not operate it from this branch's earlier private-launcher instructions.

## Checks and artifacts

[Verification](verification.md) records exact suites and limits. [Local rehearsal evidence](../evidence/release/local-wasm-rehearsal.json) pins source/artifact hashes. Synthetic screenshots are under `evidence/release/screenshots/`. `npm run build:demo` prepares ignored `dist/demo`, with an explicit asset/hash manifest. It does not publish anything.

Private keys, bank identities, raw proofs and runtime logs remain outside Git. Review staged content before every push. Existing repository privacy must remain unchanged. Hosting, token/key/deployer configuration, network signing, reviewer access and final submission need their existing specific authorizations checked before execution.
