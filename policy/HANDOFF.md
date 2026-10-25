# Payment-policy integration handoff

Objective: implement the strict server evidence/order-to-claim boundary for Pactlane's fixed whole-offer EUR/Revolut testnet flow. Live proof/runtime ownership stays with the TLSNotary PoC thread.

- Execution host: Mac mini, Node 26.7.0, 25 October 2026.
- Repository: private `vmichalik/stellar-p2p`.
- Worktree: `/Users/vijay/Documents/workspace-personal-projects/pactlane-policy`.
- Branch: `codex/pactlane-payment-policy`, isolated from baseline `807412686da2cdad494ee284675dbefc35110257`.
- Initial implementation commit: `52600e2afd68363369486b3d7e098c0e95d248c0`; initial handoff commit: `dd7259c`. The later presentation follow-up is described below. Integrate the branch's scoped commit stack, or take its `policy/` tree.
- Scope: `policy/` only. No app, contract, main-checkout documentation, live runtime, account, bank permission, RPC or deployment files were changed. Nothing was pushed or published.

## Delivered

The public method accepts only `{orderId,evidenceId}` and constructs claims from server-side evidence and authoritative order lookups. It rejects caller evidence, digests and claim overrides. The synthetic end-to-end test covers trusted fixture lookup, exact locked-order matching, canonical claim/digest construction, a durable reservation before signing, and signature verification against the configured signer.

The policy validates exact EUR cents/base units, recipient commitment with private offer salt, completed outgoing state/type, source host/method/status, stable payer-scoped identity and payment time bounds. It permits proof completion after `pay_by` for an in-window payment, while requiring a confirmed `Paying` order and fresh ledger snapshot. No floating-point conversion or inferred real bank semantics is implemented.

SQLite replay bindings span orders and deployments. Signing failures and uncertain delivery remain reserved; retries use the original digest/expiry. Expiry never frees the payment. Concurrent independent SQLite handles cannot issue the same payment for different orders. Confirmed releases keep the identity consumed. Unknown manual resolution creates a durable global signing hold; only a complete trusted manifest for a confirmed `Resolved` order clears it while permanently consuming every identified payment, including refund/split cases.

Live ingestion deliberately has no success path: `normalizeLiveTlsnPayment` always raises `TLSN_PAYMENT_SCHEMA_UNVERIFIED`. Synthetic fixtures have a separate factory/store mode and fixed public test key, no live signing callback or release client, and return `SYNTHETIC_POLICY_CLAIM_NOT_FOR_RELEASE` / `NOT_CLEARED`. Both that key and the contract's public vector key are rejected by the live signing adapter.

## Frozen contract compatibility

The early encoder drift identified by the coordinator was corrected by copying the canonical file again, without editing a separate implementation. The checked snapshots match contract owner revision **`6196df363e4b711dc1a0cf3c2b7cab8aa0bf0a78`**, branch `pactlane-escrow`:

| Canonical artifact                       | Policy snapshot                              | SHA-256                                                            |
| ---------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `contracts/escrow/protocol/protocol.mjs` | `policy/vendor/escrow-protocol.mjs`          | `08e73cbd4d2507ef85c62317638a4d4fcefd922d9de1ba3822793450cbd2127e` |
| `contracts/escrow/protocol/vectors.json` | `policy/test/fixtures/protocol-vectors.json` | `354e82ac989709a518b150506ec7424601e7a6ed8d63e20e3825ef7e026e3dcb` |

Both vectors reproduce exact recipient/nullifier XDR, claim XDR, digest and valid Ed25519 signature. This lane did not rerun Rust/WASM tests; those remain the contract owner's evidence. `vendor/manifest.json` records the source revision and hashes. The sync check must pass against the integrated contract tree before release.

## Checks actually run

- `npm --prefix policy test`: **51 passed**, zero skipped/failed; includes synthetic success, source/state/identity/amount/time mismatch rejection, no client digest ingestion, signing-failure retry, restart durability, concurrent issuance, cross-order/deployment replay, changed-order retry rejection, manual holds/manifests and confirmed-release reconciliation.
- `npm --prefix policy run check:protocol -- /Users/vijay/Documents/workspace-personal-projects/pactlane-escrow`: passed against the frozen owner revision above.
- Package-local Prettier check using `policy/.prettierignore`: passed.
- `node --check` for all policy source, script, test and vendor modules: passed.
- Existing repository `npm test`: **32 passed**.
- Existing repository `npm run check`: **28 JavaScript modules and inline scripts passed** with the new package present.
- Staged content and whitespace review: passed. Included signing seeds are explicitly public synthetic fixtures; no bank identities, transcripts, private runtime logs or real credentials are included.
- Root Prettier check: **one expected warning**, `policy/vendor/escrow-protocol.mjs`, because its byte-identical canonical source is intentionally unformatted under the root rules. Package-local formatting excludes it. Root integration must add the snapshot exclusions described below; this lane did not change shared root configuration.

## Release integration

1. Integrate the contract owner revision and this branch's `policy/` tree. Install with `npm --prefix policy ci --ignore-scripts`; run `npm --prefix policy test` and `npm --prefix policy run check:protocol` from the integrated root. The standalone policy worktree lacks `contracts/`, so its sync command needs the owner-worktree argument.
2. Add the package test/sync commands to release checks. Add `policy/vendor/escrow-protocol.mjs` and `policy/test/fixtures/protocol-vectors.json` to root formatter exclusions to preserve byte identity. Root package/script/ignore reconciliation belongs to the release integrator.
3. For a labeled synthetic rehearsal, use the explicit `./testing` factory with server fixture maps and a `ReplayStore(...,{syntheticOnly:true})`. Keep the resulting signature and claim in the synthetic adapter; no live release route is provided by this package.
4. Implement authenticated server adapters for a consistent confirmed escrow/config/payment-used snapshot and the private offer-data salt. Wire a trusted chain indexer and every served deployment into the durable replay registry. The adapter shapes, checkpoint/hold requirements and method inputs are documented in `README.md`.
5. Only after the proof owner's reviewed evidence contract is available, implement and test the live normalizer. The active owner response-shape check is in the PoC lane; do not create another runtime or bank diagnostic here.

## Remaining blockers and limits

The live schema still needs independently verified source host/status/read-only endpoint and JSON context, exact completed outgoing state/type, amount sign/units/currency and fee interpretation, completion timestamp semantics/precision/timezone, stable provider-issued recipient identity, stable sending-account `payer_scope` and payment ID across retries/views, plus the association of the response identity with the selected transfer. The fixed protocol requires the source account and recipient identifiers; user labels, display names, cookies, URL parameters and wallets cannot substitute for them. A new disclosure/account binding is outside this lane's authority.

There is no authenticated bank payment, live signer, RPC implementation, deployed registry/indexer, wallet transaction, escrow release or full live trade established by these tests. SQLite is local single-host plumbing, not a distributed service. Production authentication, storage protection/backup/migration and complete manual-recovery manifests remain host integration work. Expired claim renewal deliberately rejects with `CLAIM_RENEWAL_REQUIRES_RECONCILIATION`; no automatic renewal or unreserve operation exists. A signer/operator must reconcile the order and unknown submission outcome before adding any renewal behavior.

Next action: the release integration thread can cherry-pick this scoped implementation and handoff, wire the labeled synthetic rehearsal, and keep live ingestion rejecting while the proof owner completes evidence semantics. The working tree should be clean after the handoff commit; installed dependencies remain ignored.

## App-state follow-up, 25 October 2026

Added a browser-safe `./presentation` package entry point and [APP-STATES.md](APP-STATES.md). `presentPolicyOutcome` maps fixed codes/results to state/message/action tokens; app copy and styling remain with the app owner. No raw exception, bank value, account identity, transaction hash, URL or arbitrary code is reflected. Outputs are presentation-only and always prohibit automatic retry, payment resend and release authorization.

Payment mismatch, unavailable proof and used transfers have distinct review actions. Mutual recovery requires explicit trusted context for this order: a global manual-reconciliation hold alone cannot establish which parties still need to approve. A pending or uncertain submitted release also requires explicit context from the transaction adapter and takes priority over another proof/payment attempt. A generic policy-adapter failure maps to issuance review, not an invented submitted-transaction state. Synthetic and merely policy-accepted results do not become confirmed receipts.

No frozen protocol, evidence normalizer, signing/replay behavior, app files, domains, DNS or live runtime was changed. `pactlane.io` / `proof.pactlane.io` routing remains with the owning lanes. The bank source-origin namespace inside the frozen protocol must remain `https://app.revolut.com` during product-domain migration.

The follow-up adds four focused presentation tests to the existing suite: **55 tests passed**, the shared-protocol synchronization check passed, package-local formatting passed and the repository syntax check passed for **30 modules and inline scripts**. Exact delivery commit is recorded in the thread's final response. Next: the app owner can consume the fixed state/action tokens and provide transaction/recovery context from its trusted lifecycle adapters. Live ingestion remains rejecting and no owner bank test is required for this work.
