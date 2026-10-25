# Development handoff

Objective: finish the hackathon prototype outside the excluded Revolut proof gate, and explain its contracts, evidence, signing, recovery and operations.

Execution host: Mac mini, Apple Silicon macOS. Repository: `/Users/vijay/Documents/workspace-personal-projects/pactlane-integration`. Branch: `codex/pactlane-integration`. Base: `c9845e51082dabcdfbd61d1a74d9606b376796e3`. The current checkout is on that base with new local changes; the implementation commit is recorded in Git and the final verification record. These changes have not been pushed or deployed.

The [architecture study](architecture/study.html) is the read-first explainer. The [status](status.md) separates source, local checks, the testnet rehearsal, and remaining limits. The [captured testnet record](../evidence/release/testnet-rehearsal-2026-10-25.json) reports a passed synthetic PLTEST release, replay rejection, and mutual half split using the reviewed WASM and programmatic disposable keys.

The public `https://pactlane.io` app remains a separate synthetic app. Its audit recorded source revision `88ba889` and manifest SHA-256 `57976a8918229887b98629139bf2f94ed729bad6acf2181b3f51b8fd886ebebe`; this local work did not alter or redeploy it. The bank gate remains `NOT_CLEARED`: live normalization rejects with `TLSN_PAYMENT_SCHEMA_UNVERIFIED`, no real USDC or accepted bank payment was tested, and Freighter UI behavior is unvalidated. The verifier privacy patch passed offline Cargo check but has not been release-built or deployed.

## Resume and verify

1. Read [status](status.md), [verification](verification.md), and the architecture study.
2. Run `npm ci --ignore-scripts`, then `npm run setup:integration`, `npm run test:all`, `npm run check`, and `npm run format:check` as needed. Use the verification record for actual results and limits; do not copy old totals as current.
3. For the browser demo, run `npm run dev:app`. This is still a synthetic app and is distinct from the testnet workbench.
4. The historical [testnet evidence](../evidence/release/testnet-rehearsal-2026-10-25.json) is already captured. Do not repeat network actions without the appropriate authorization and a fresh disposable setup.
5. Continue against the [remaining build plan](build-plan.md). Resolve the accepted evidence schema and source identities before implementing or enabling a live payment normalizer.

Private keys, bank identities, raw proof material, and runtime secrets stay outside Git. The new local documentation and prototype must remain separate from public app release decisions.
