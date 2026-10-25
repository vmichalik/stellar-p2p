# Development handoff

## Latest: mainnet completion request, 25 October 2026

The active continuation is the isolated `codex/pactlane-mainnet-completion` candidate. Network support, Freighter transport and the accepted TLS proof flow are integrated locally. A read-only mainnet USDC check passed; no mainnet transaction or deployment has occurred. Complete-record ingestion is implemented and its diagnostic page is deployed; owner-reviewed live record acceptance is pending. Payment release remains **NOT_CLEARED**. The owner confirmed a 1 USDC / EUR 0.89 test; durable operator composition and concrete transaction/fee review remain. Read [the current mainnet handoff](release/mainnet-test.md) first; it supersedes the older bank pause and source-intake state below.

Objective: finish one Revolut-to-Stellar trade from the integrated Pactlane candidate.

Execution host: Mac mini, Apple Silicon macOS. Current owner browser device: MacBook Pro. These devices do not share local files, browser profiles or loopback addresses.

Repository: private [vmichalik/stellar-p2p](https://github.com/vmichalik/stellar-p2p). Integration source worktree: `/Users/vijay/Documents/workspace-personal-projects/pactlane-integration`, branch `codex/pactlane-integration`, snapshot `c8f44752b82b1fe8f766028a782e7759caef2cc7`. Current isolated intake checkout: `/private/tmp/pactlane-coordinator-review-20261025`, branch `codex/pactlane-mutual-recovery` (based on checked live browser/host `4cb97bf`). Base: `807412686da2cdad494ee284675dbefc35110257`. Runtime integration commit: `006ab023e4d44600d03f320f220457e5b5545f0e`. The TLS source snapshot is `2c98f8e86ee3fb6c9f89c14883c43b0a0d38f03a`; its deployed plugin source is `f433423`. Use `git rev-parse HEAD`, `git status --short` and, during intake, `git rev-parse MERGE_HEAD` to distinguish the committed base from local merge changes. Combined local verification passed 183 JavaScript tests with zero skips, eight benchmark-preparation tests and 65 syntax checks. A remote push or combined-app deployment is not established by source intake.

Main's dirty proof docs/evidence and coordinator note were preserved. Component owners' worktrees and running proof services were not changed. This branch can be reviewed or merged separately; do not reset main over those changes.

The [live service continuation](release/live-services.md) adds the Node browser bridge, chain reader/indexer and mutual-recovery authorization. A separate live browser, Freighter client and host composition are now implemented; seller recovery transport is now wired and locally checked. Approved configuration and deployed validation remain outstanding.

## Resume

1. Read [status](status.md), [release handoff](release/HANDOFF.md) and [proof handoff](proof-handoff.md). Bank tests remain paused.
2. Run `npm ci --ignore-scripts` and `npm run setup:integration`; prepare the pinned ignored TLS runtime assets using [setup](setup.md). Then run `npm run test:all` (including Python benchmark-preparation checks) and `npm run check`. Require zero skipped runtime tests; record the combined candidate revision and actual results.
3. Start the synthetic browser demo with `npm run dev:app`, or the unconfigured live host with `npm run dev:live`. Both listen locally; neither provides a remote-device handoff.
4. With compatible Rust available, run `npm run rehearse:local`; it uses the tracked WASM and synthetic evidence, and submits no network transaction.
5. Finish the live software gaps in [integration](../integration/README.md), then prepare the configured, authorized testnet rehearsal.

## Current boundary

App, policy and escrow work together locally. The browser demo is simulated. Live TLSNotary payment ingestion rejects unverified records. No accepted authenticated payment, deployed escrow, network receipt or public app URL is established by this branch.

The Node wallet/RPC service candidate is implemented and unit checked, with local browser-transport, trusted chain-reader/indexer and two-wallet authorization modules now implemented. The live host and browser are implemented. Approved private offer/policy composition and the live normalizer remain. Seller approval transport is implemented and checked with fixture wallets. These need implementation and evidence as well as deployment authorization. Sanitized cloud source and the plugin/deployment chronology are imported in [the proof handoff](proof-handoff.md). The failed server connection is explained by Fly’s five-minute trial shutdown; the later 391.5-second bank-free uptime observation passed the former cutoff. The separately reproduced QuickJS defect is mitigated, not fully fixed. None clears the payment gate or resumes bank tests. Local import does not deploy the combined app or authorize changing the existing proof runtime.

## Checks and artifacts

[Verification](verification.md) records integration-source suites and limits; [proof verification](proof-verification.md) preserves the separate TLS history. The combined local JavaScript/Python/syntax checks passed; the previous native/WASM escrow suites and local WASM rehearsal were not rerun during this intake. [Local rehearsal evidence](../evidence/release/local-wasm-rehearsal.json) pins source/artifact hashes. Synthetic screenshots are under `evidence/release/screenshots/`. `npm run build:demo` prepares ignored `dist/demo`, with an explicit asset/hash manifest. It does not publish anything.

Private keys, bank identities, raw proofs and runtime logs remain outside Git. Review staged content before every push. Existing repository privacy must remain unchanged. Hosting, token/key/deployer configuration, network signing, reviewer access and final submission need their existing specific authorizations checked before execution.
