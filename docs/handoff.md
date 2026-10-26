# Mainnet continuation — 26 October 2026

Objective: complete one owner-approved mainnet trade: 1 USDC for EUR 0.89. Work runs on the Mac mini; wallet and bank approvals happen on the owner’s MacBook Pro.

Active worktree: `/private/tmp/pactlane-mainnet-live-20261026`, branch `codex/pactlane-mainnet-live`, based on `e39eaa21efd45f4a81ec500ac962728f14691fa7`. This source commit adds the live operator, durable payment policy, bounded wallet deployment and same-origin exchange API. The subsequent publication receipt will identify deployed source and hashes.

The owner approved a combined 25 XLM deployment-fee ceiling, one 1 GB Fly volume and a private server policy key. The seller top-up was observed at 08:40 UTC (154.26 XLM); upload simulation estimated 19.735636 XLM. Both wallets have authorized Circle USDC trustlines and sufficient token balance. No deployment transaction has been submitted by the agent.

Two accepted historical records were backed up and restored to encrypted volume `vol_vz80xl0nk9wy5xjv` in cdg. SQLite integrity and record count passed before and after migration. They establish the owner-reviewed bank identity binding only; the new order still requires a new EUR 0.89 payment after its confirmed lock. Raw records, bank IDs, the destination, private seed and owner inputs remain outside Git.

The replacement machine is `830d12add66258`; the previous machine `85e769b4196298` remains the rollback source until public cutover. Candidate image: `sha256:90bab3a4c26582c656dd35b18a33dd0a27db89766490e9110796c6d1a48f3957`. It reuses the pinned verifier binary and WASM from the prior image. The current extension is unchanged. Deployment state, policy authorizations, replay history and transaction journals use persistent storage.

Checks: 383 JavaScript tests passed in the complete suite, with 36 prepared-artifact checks skipped. A subsequent gateway run with the existing pinned assets passed all 22 cases (18 additional cases); the complete operator startup/origin/key-approval test also passed. Eight preparation checks and canonical protocol synchronization passed. Syntax checks covered 144 modules/inline scripts. The contract artifact was unchanged and not rebuilt. Initial sandbox listener failures were rerun with loopback permission; one stale staged-page mismatch was resolved by using the current page source with the unchanged binary artifacts.

Next: finish private health checks, switch the existing Fly application to the replacement machine, publish the same-origin Worker API connection, and guide the owner through `/setup`. Each deployment transaction requires the seller’s wallet signature and is checked against the exact prepared hash and the remaining fee cap. Unknown outcomes must reconcile before any new transaction. After deployment: fund, reserve, lock, new bank payment, authenticated complete-record proof, policy acceptance, wallet-signed release, and receipt/balance reconciliation. **Release gate: NOT_CLEARED.**

Previous website/source publication record follows.

---

# Project handoff

## Objective and source

Make Pactlane easy for users and HackMeridian judges to understand: a clear buyer/supplier story, realistic product demo, readable implementation docs and directly linked evidence.

Execution host: Vijay's Mac mini. Owner browser: MacBook Pro. Review checkout: `/private/tmp/pactlane-judge-review-20261025`, branch `codex/pactlane-judge-review`. Integrated base `421dcfc` combines mainnet/proof source `abcd980` and published website source `890b336`. Reviewed source `8b9d653fcde4a12811e697418d77b11d4b51df87` is published on GitHub main and serves the website. The following documentation commit records publication; it changes no deployed application bytes. The Documents checkout remains untouched because macOS denies access on this host.

The application repository remains private. The extension repository remains public. No bank request, wallet signature or fund movement was performed by this review.

## Changes

The README, pitch, submission answers and architecture now lead with the user and one trade. Old coordination essays link to the current record. The criteria guide maps the product to the official rubric. The operator runbooks preserve exact configuration, payment-lock, disclosure, retry and recovery requirements.

The demo uses normal product copy with a visible Demo mode switch. Only funded offers are shown. The live host now serves the shared mode entry, navigation module, stylesheet and required assets; demo mode blocks connections even when mobile relays are configured. Live mode never falls back to sample balances or offers.

The new 90-second film uses fresh product captures and a current evidence card. The accepted Revolut record and separate PLTEST testnet transactions retain their actual scope. Editable source is in `design/demo`; [the shot list](demo/shot-list.md) identifies morning replacements.

## Checks

- Combined suite: 401 JavaScript tests passed, 11 extension-watchdog cases skipped because the separate prepared package is absent; 8 Python checks passed.
- Syntax: 138 module/inline scripts passed before the final media addition.
- Browser: complete sample funding/reservation/lock/verification/receipt; recovery with two approvals; live/demo isolation; mobile widths 320, 390, 760, 1024, 1440; no page errors.
- Live host: shared entry, asset loading and demo toggle passed. Architecture overview passed at 320, 390 and 1440 pixels.
- Video: 18 composition snapshots, no clipped text or external requests, deterministic random-access seeking. The export fully decoded and its public hash matches the reviewed file.
- Documentation:current relative file links resolve. Review diff and publication receipts for the final source/hash.

The unchanged escrow was not rebuilt. The recorded testnet release and recovery were freshly queried through RPC and both returned `SUCCESS` at their recorded ledgers. [Verification](verification.md).

## Publication and next action

Published 25 October 2026 at 23:55 UTC: the existing Worker `pactlane-demo` runs `489d13e2-2889-40d7-931b-e26ef7447d13` at 100%. Public browser verification matched all 42 asset hashes, including the new 90-second film, and found no page errors. [Publication receipt](../evidence/release/judge-review-publication.json). Rollback version: `c7154099-63c9-4c7b-987d-cb0b7f706aa4`.

GitHub main now contains the integrated source and reviewed docs. Extension docs are published at `0ccef53` on its existing default branch, and the Pactlane.2 release notes are updated. Its ZIP digest remains `9a27e54c24a2a80a64661f47bac6eeb2d7876c08ea89126f33f5e67da3d80be2`.

The Fly proof image and extension binaries are unchanged. The film fully decoded: 1920×1080, 30fps, 2,700 frames, 90 seconds, no audio. Source and captures are tracked under `design/demo`; render output and local logs remain ignored under `.private/`. There are no outstanding source edits after the publication-record commit. The original worktrees are preserved.

Next technical action: follow [the mainnet runbook](release/mainnet-test.md) to connect the durable operator, policy signer, wallet-to-bank bindings and public exchange API for the approved 1 USDC / EUR 0.89 trade. No mainnet receipt is available in this checkout; payment release remains `NOT_CLEARED`.

Next submission action: check the portal fields and judge access, replace the specified screenshots with actual available evidence, and retain the submission receipt. [Judging guide](hackathon.md).
