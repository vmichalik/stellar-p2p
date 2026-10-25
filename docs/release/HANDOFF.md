# Release integration handoff

Follow-up: [domain/source handoff](DOMAIN-HANDOFF.md) supersedes the initial snapshot below for domains, TLS source, policy presentation and final app-intake status. Do not deploy the intermediate app while its two pending recovery fixes remain open.

Objective: deliver one reviewed Pactlane candidate from frozen app, policy and escrow snapshots, with an actual local cross-component rehearsal and an honest live gap list.

Host: Mac mini, 25 October 2026. Worktree: `/Users/vijay/Documents/workspace-personal-projects/pactlane-integration`. Branch: `codex/pactlane-integration`. Base: `807412686da2cdad494ee284675dbefc35110257`. Runtime commit: `006ab023e4d44600d03f320f220457e5b5545f0e`; final handoff/evidence revision is the branch HEAD. Run `git rev-parse HEAD` and `git status --short` before continuation.

## Delivered

- Frozen scoped app, policy and escrow imports; exact mapping in [integration](integration.md).
- Root install/test/check/rehearsal/build commands and reconciled README, setup, concept, architecture, pitch, status and handoff.
- App-model → real policy/durable SQLite → canonical Ed25519 claim → actual optimized escrow WASM → one local token release → contract/policy/UI replay rejection.
- Testnet-only SDK wallet/RPC candidate with capped fees, exact envelope/signature checks, confirmed-lock instruction gate, receipt token events and atomic persistent transaction journal. No default submission permission.
- Seven-asset static demo build with hashes and synthetic/no-live-settlement manifest.
- Sanitized local rehearsal report and desktop/mobile synthetic screenshots.

## Actual checks

122 JS tests passed: 49 root, 51 policy, 11 canonical protocol, 11 wallet/RPC/journal. Policy protocol sync passed. 29 native and the same 29 compiled-WASM escrow cases passed. One cross-component compiled-WASM rehearsal passed after a byte-identical CLI rebuild. 49 JavaScript syntax checks passed. Prettier/diff review completed; Rustfmt is absent, so no Rustfmt pass is claimed.

Browser: create/fund as seller → reserve as buyer → confirm lock before instructions → unavailable proof holds → retry → simulated receipt. Reload preserves completion; seller balances agree. Desktop, 390px receipt and 320px seller checked; no horizontal overflow or console warning/error observed. Screenshots are under `evidence/release/screenshots/`.

These are local/synthetic checks. Network calls in this lane were read-only testnet RPC checks, not deployment or transaction submission. See [verification](../verification.md) and [recorded rehearsal](../../evidence/release/local-wasm-rehearsal.json).

## Current limitations

The live payment gate is `NOT_CLEARED`. Public proof success reported by the proof lane is separate; no authenticated transfer has been accepted here. The reviewed TLS source and revised demo text are integrated in the follow-up. Final rendered video/deck remain separate. The proof owner's running services and main's dirty files are untouched.

The Node wallet/RPC candidate is not wired into the browser. Authenticated transport, private offer/chain/policy readers, a complete indexer and dual-wallet recovery collection still need implementation. `resolve` deliberately refuses a one-wallet shortcut. Live normalization deliberately rejects unknown semantics.

The optimized artifact requires protocol 29; official testnet RPC reported protocol 29 at 13:03 UTC. No token, signer, deployer or fee configuration is established. No network account creation, funding, signature, deployment, settlement, hosted app URL, reviewer invitation or submission was performed.

## Next action

Finish accepted evidence semantics and authenticated host wiring, then use the exact artifact/configuration for an authorized testnet trade with transaction/balance receipts. If that remains blocked, the candidate supports a truthful local-WASM demonstration and labeled browser simulation. Keep the silent-video instruction and approved mutual-consent recovery. An uncooperative party can leave a locked trade unresolved.

The isolated branch is the handoff; no main merge or reset is required to inspect it. Existing main proof docs/evidence and coordinator-owned note remain local to their owners.
