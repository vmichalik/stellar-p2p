# Remaining build and validation

The contract and integration mechanics have now passed a disposable testnet rehearsal with synthetic evidence and PLTEST. The next work is to establish the real evidence semantics and production controls, not to treat that rehearsal as a live bank trade. The release gate remains `NOT_CLEARED`.

## 1. Establish acceptable payment evidence

Work from the proof owner's accepted response-only validation. Document how a selected transfer maps to source and account, payer scope, recipient, amount and unit, direction, completed state, timestamp, and stable transfer ID. Implement the live normalizer only against that documented schema. Preserve fail-closed behavior and test wrong source, recipient, amount, sign, state, time, and duplicate identity.

Done when an accepted real evidence record can be evaluated without disclosing unrelated activity, and every mismatch stays blocked. Keep raw records and identifiers out of Git and sanitized test output. Until then, do not request or use real bank values.

## 2. Validate real wallet interaction and operational custody

The local source now includes browser-to-host transport, a Freighter bridge, deployment verification, chain readers/indexer, private offer handling, durable journals, and both signatures needed for Soroban recovery. The testnet rehearsal used disposable programmatic keys, so it does not validate extension prompts or real user review.

Before relying on these components outside rehearsal, validate Freighter's testnet network/address checks and both recovery signatures; review private configuration and signing-key storage; verify the host origin, access capability, service adapters, restart behavior, and manual reconciliation procedure. Keep submission disabled unless an explicitly reviewed test deployment enables it.

Done when a reviewer can independently reproduce supported wallet actions, confirm that unknown submission is reconciled by its saved hash, and explain how recovery holds are reviewed. This still does not establish production readiness.

## 3. Preserve the passed testnet evidence

The 25 October rehearsal already deployed the reviewed WASM and confirmed a PLTEST release, replay rejection, and mutual half split. Preserve the [run record](../evidence/release/testnet-rehearsal-2026-10-25.json), including its source hashes and limitations. Do not rewrite it as a USDC or bank-payment result. Any future rehearsal should use a fresh disposable setup and a distinct record.

Done when the evidence is independently reviewable against the testnet transactions, contract identity, WASM hash, order states, and token events. For the current run, these receipts are recorded; they do not establish real-user wallet behavior or real asset settlement.

## 4. Verify verifier privacy controls

The source patch removes transcript log formatting at INFO and DEBUG and rejects Proxy commitment mode before proxy-target connection. Its patched Rust verifier passed `cargo check --offline`.

Done when a release build is reviewed, deployed only through the appropriate owner-controlled process, and runtime logging behavior is tested with non-sensitive fixtures. Until then, describe this as a source-level patch with a successful compile check, not deployed log protection.

## 5. Update the demo and submission story

Keep the public synthetic app distinct from the private local host/workbench. The public audit records revision `88ba889` and manifest SHA-256 `57976a8918229887b98629139bf2f94ed729bad6acf2181b3f51b8fd886ebebe`; no change to it is part of this work. Explain the passed synthetic testnet rehearsal alongside the still-closed bank gate, and avoid implying USDC, anonymous use, or “trustless” verification.

The [standalone study](architecture/study.html), [talk tracks](architecture/talk-tracks.md), and [verification record](verification.md) are the reference for a technically accurate explanation. Hosting, release, and submission decisions remain separate from this local documentation and code work.
