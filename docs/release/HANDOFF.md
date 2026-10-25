# Release integration handoff

Objective: deliver one reviewed Pactlane candidate from frozen app, policy and escrow snapshots, with an actual local cross-component rehearsal and an honest live gap list.

Host: Mac mini, 25 October 2026. Worktree: `/Users/vijay/Documents/workspace-personal-projects/pactlane-integration`. Branch: `codex/pactlane-integration`. Base: `807412686da2cdad494ee284675dbefc35110257`. Integration source snapshot: `c8f44752b82b1fe8f766028a782e7759caef2cc7`. Current local intake is in `/private/tmp/pactlane-coordinator-review-20261025` on `codex/pactlane-coordinator-intake`, importing TLS snapshot `2c98f8e86ee3fb6c9f89c14883c43b0a0d38f03a`. Runtime commit: `006ab023e4d44600d03f320f220457e5b5545f0e`; final handoff/evidence revision is the branch HEAD. Run `git rev-parse HEAD` and `git status --short` before continuation.

## Delivered

- Frozen scoped app, policy and escrow imports; exact mapping in [integration](integration.md).
- Root install/test/check/rehearsal/build commands and reconciled README, setup, concept, architecture, pitch, status and handoff.
- App-model → real policy/durable SQLite → canonical Ed25519 claim → actual optimized escrow WASM → one local token release → contract/policy/UI replay rejection.
- Testnet-only SDK wallet/RPC candidate with capped fees, exact envelope/signature checks, confirmed-lock instruction gate, receipt token events and atomic persistent transaction journal. No default submission permission.
- Seven-asset static demo build with hashes and synthetic/no-live-settlement manifest.
- Sanitized local rehearsal report and desktop/mobile synthetic screenshots.

## Historical integration checks

The following results belong to the integration source snapshot. The separate TLS history is in [proof verification](../proof-verification.md). During local intake, the coordinator also passed 183 combined JavaScript tests with zero skips (110 root, 51 policy, 11 protocol, 11 wallet/RPC), eight Python benchmark-preparation tests and 65 syntax checks. The prior native/WASM escrow suites and WASM rehearsal below were not rerun. [Verification](../verification.md) records the loopback-permission rerun and prepared-runtime provenance.

122 JS tests passed: 49 root, 51 policy, 11 canonical protocol, 11 wallet/RPC/journal. Policy protocol sync passed. 29 native and the same 29 compiled-WASM escrow cases passed. One cross-component compiled-WASM rehearsal passed after a byte-identical CLI rebuild. 49 JavaScript syntax checks passed. Prettier/diff review completed; Rustfmt is absent, so no Rustfmt pass is claimed.

Browser: create/fund as seller → reserve as buyer → confirm lock before instructions → unavailable proof holds → retry → simulated receipt. Reload preserves completion; seller balances agree. Desktop, 390px receipt and 320px seller checked; no horizontal overflow or console warning/error observed. Screenshots are under `evidence/release/screenshots/`.

These are local/synthetic checks. Network calls in this lane were read-only testnet RPC checks, not deployment or transaction submission. See [verification](../verification.md) and [recorded rehearsal](../../evidence/release/local-wasm-rehearsal.json).

## Current limitations

The live payment gate is `NOT_CLEARED`. Public proof success reported by the proof lane is separate; no authenticated transfer has been accepted here. Sanitized cloud proof source and deployment/uptime evidence are imported through `2c98f8e`; the final video/deck handoffs are still missing. The server disconnect was explained by Fly’s five-minute trial stop. After an owner-reported PAYG upgrade, the same VM passed a finite 391.5-second uptime check. The deployed plugin allocation mitigation is not a complete QuickJS/disposal fix. **Bank tests remain paused** pending the owner’s decision to resume and normal per-attempt consent/disclosure review. The proof owner's running services and main's dirty files are untouched.

The Node wallet/RPC candidate is not wired into the browser. The [live continuation](live-services.md) implements authenticated transport, a consistent chain reader, event reconciliation and mutual-recovery signatures. Running host composition, private offer/policy ports and browser/counterparty wiring remain. Live normalization deliberately rejects unknown semantics.

The optimized artifact requires protocol 29; official testnet RPC reported protocol 29 at 13:03 UTC. No token, signer, deployer or fee configuration is established. No network account creation, funding, signature, deployment, settlement, hosted app URL, reviewer invitation or submission was performed.

## Next action

Preserve the merged candidate’s zero-skip local check results and the separate historical WASM evidence. Continue authenticated host wiring independently while bank tests are paused. Once the owner resumes and accepted payment semantics are established, use the exact artifact/configuration for an authorized testnet trade with transaction/balance receipts. If that remains blocked, the candidate supports a truthful local-WASM demonstration and labeled browser simulation. Keep the silent-video instruction and approved mutual-consent recovery. An uncooperative party can leave a locked trade unresolved.

The isolated branch is the local handoff; source intake is not a combined-app deployment or remote push. No main merge or reset is required to inspect it. Existing main proof docs/evidence and coordinator-owned note remain local to their owners.
