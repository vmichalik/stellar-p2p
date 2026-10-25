# Development handoff

Objective: finish the hackathon prototype outside the excluded Revolut proof gate, and explain its contracts, evidence, signing, recovery and operations.

Execution host: Mac mini, Apple Silicon macOS. Repository: `/Users/vijay/Documents/workspace-personal-projects/pactlane-integration`. Branch: `codex/pactlane-integration`. Implementation commit: `0c280777977b12c222857014ae07d3ed32a21c50`. The user explicitly approved the private source push. Source through `a614967d132d2449948f69ddcb30cb7bc7bdc817` was pushed to `origin/codex/pactlane-integration`, and GitHub confirmed the repository remained private. See the [push receipt](../evidence/release/private-source-push.json). No public app or proof-runtime deployment changed.

The [architecture study](architecture/study.html) is the read-first explainer. The [status](status.md) separates source, local checks, the testnet rehearsal, and remaining limits. The [captured testnet record](../evidence/release/testnet-rehearsal-2026-10-25.json) reports a passed synthetic PLTEST release, replay rejection, and mutual half split using the reviewed WASM and programmatic disposable keys.

The public `https://pactlane.io` app remains a separate synthetic app. Its audit recorded source revision `88ba889` and manifest SHA-256 `57976a8918229887b98629139bf2f94ed729bad6acf2181b3f51b8fd886ebebe`; this local work did not alter or redeploy it. The bank gate remains `NOT_CLEARED`: live normalization rejects with `TLSN_PAYMENT_SCHEMA_UNVERIFIED`, no real USDC or accepted bank payment was tested, and Freighter UI behavior is unvalidated. The verifier privacy patch passed offline Cargo check but has not been release-built or deployed.

## Resume and verify

1. Read [status](status.md), [verification](verification.md), and the architecture study.
2. Run `npm ci --ignore-scripts`, then `npm run setup:integration`, `npm run test:all`, `npm run check`, and `npm run format:check` as needed. Use the verification record for actual results and limits; do not copy old totals as current.
3. For the browser demo, run `npm run dev:app`. This is still a synthetic app and is distinct from the testnet workbench.
4. The historical [testnet evidence](../evidence/release/testnet-rehearsal-2026-10-25.json) is already captured. Do not repeat network actions without the appropriate authorization and a fresh disposable setup.
5. Continue against the [remaining build plan](build-plan.md). Resolve the accepted evidence schema and source identities before implementing or enabling a live payment normalizer.

Private keys, bank identities, raw proof material, and runtime secrets stay outside Git. The new local documentation and prototype must remain separate from public app release decisions.

Two unrelated untracked files, `README 2.md` and `docs/status 2.md`, were left untouched and excluded from the commits. Private runtime files, testnet journals and disposable diagnostic output remain ignored.

The read-only workbench preview was stopped after its browser checks, revoking its temporary capability. The architecture study is self-contained; `npm run read:architecture` serves its local preview. A loopback URL is not a Windows-device handoff. Open or download `docs/architecture/study.html` through Codex or from the private repository branch.

The read-only architecture preview is running on Mac-mini loopback port `8788` for the Codex browser, using `node scripts/serve-architecture.mjs`. It serves the guide and its explicit source links only. Stop that process when the preview is no longer needed; the HTML itself works offline.
