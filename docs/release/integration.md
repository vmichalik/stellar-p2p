# Pactlane integration candidate

This branch assembles stable component handoffs for review. It does not change repository visibility, submit the project, invite reviewers, send bank requests or deploy services.

## Starting point

- Repository: private `vmichalik/stellar-p2p`.
- Branch: `codex/pactlane-integration`.
- Base: `807412686da2cdad494ee284675dbefc35110257`.
- Execution: Mac mini; browser-device readiness must be checked separately.
- Baseline: 32 TLSNotary tests and 18 JavaScript syntax checks passed on 25 October 2026.
- Main's existing proof docs, evidence and coordination note are outside this branch's changes and must be preserved.

## Component intake

Accept a scoped commit or an explicitly frozen, hashed file manifest. Do not copy from a worktree while its owner is editing. Inspect each commit's paths before integrating it. Root package and canonical docs are reconciled here rather than accepted wholesale from another lane.

| Component | Source branch / lane | Intake status |
| --- | --- | --- |
| Escrow and canonical claim encoding | `pactlane-escrow` | Waiting for committed snapshot and shared vectors |
| Buyer/seller app | `codex/pactlane-ui` | Waiting for whole-offer and payment-lock alignment |
| Payment policy | Resolve TLSNotary payment-proof gate | Waiting for isolated implementation and handoff |
| Proof runtime | Pactlane TLSNotary PoC | Waiting for sanitized cloud-source snapshot |
| Submission assets | Pactlane demo and submission | Separate artifact lane; simulated shots must remain labeled |

## Rehearsal gates

| Check | Pass condition | Current result |
| --- | --- | --- |
| Root scripts | One command runs all integrated JS suites; runtime dependencies and lockfile agree | Pending intake |
| Fixed offers | Exact whole offer amount in UI, policy and contract; no partial-fill input | Pending intake |
| Payment lock | Fiat recipient and instructions appear only after confirmed `begin_payment` | Pending intake |
| Held funds | Failed proof after payment lock leaves escrow held; both parties authorize manual settlement | Pending intake |
| Evidence boundary | Browser and synthetic callbacks cannot reach a live signer or release endpoint | Pending intake |
| Claim encoding | JS policy and Rust contract reproduce the same ScVal-XDR digest and stable nullifier | Pending intake |
| Contract | Native and compiled-WASM suites pass for the imported revision | Pending intake |
| Recovery and replay | Retry/reload/duplicate actions preserve balances; repeated payment cannot settle twice | Pending intake |
| Buyer/seller UI | One funded whole offer completes a synthetic trade with matching balances and receipt | Pending intake |
| Responsive review | Desktop and mobile review; no overflow, missing controls or browser errors | Pending intake |
| Proof runtime | Public proof records actual origin, version and date separately from payment proof | Pending intake |
| Testnet | Network, asset, deployed hash and transaction/balance evidence recorded | Not established |
| Reachable demo | Third-party URL checked in a fresh browser; access limitations stated | Not established |

## Candidate scope

Prepare a static public-demo candidate that can show a clearly labeled synthetic buyer/seller trade. Keep bank login, payment proof, signing keys and live settlement outside that demo adapter. Prepare testnet configuration and rehearsal commands only after the component interfaces are fixed. Publishing, cloud changes and transaction execution require their existing specific authorizations to be established before use.

The final canonical README, status, setup and handoff must describe imported code rather than missing worktree components. Preserve historical live observation dates and distinguish owner reports, server acceptance, synthetic tests and actual chain transactions.

## Pending approval boundaries

No new authority is inferred here for repository visibility, reviewer access, submission, spending, signer custody, bank disclosure, testnet transaction execution or public hosting. The coordinator should resolve exact missing approvals against the existing human requests once a concrete candidate is ready.
