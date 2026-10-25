# Release checks

The results below were recorded on 25 October 2026 on the remote Apple Silicon Mac mini for integration snapshot `c8f44752b82b1fe8f766028a782e7759caef2cc7`; the runtime rehearsal pins `006ab023`. They do not establish an authenticated bank payment or network settlement.

## Combined source intake

The local candidate imports integration snapshot `c8f4475` and TLS source/sanitized observations through `2c98f8e`. On 25 October, the coordinator checked this merged working tree before its merge commit. Record the final commit with `git rev-parse HEAD`; the historical source counts below must not be added to these new results.

| Combined local check         | Result                                  |
| ---------------------------- | --------------------------------------- |
| Root JavaScript suite        | 110 passed, zero skipped                |
| Payment policy               | 51 passed                               |
| Canonical protocol           | 11 passed; policy snapshot check passed |
| Wallet/RPC/journal           | 11 passed                               |
| Total JavaScript             | **183 passed, zero skipped**            |
| Python benchmark preparation | 8 passed                                |
| JavaScript/inline syntax     | 65 checked                              |

The first sandbox run could not open synthetic loopback listeners (`listen EPERM`); an approved rerun with loopback access passed. This was an execution-environment limitation, not a test failure in the source. Pinned extension/source archives were staged offline from verified cached public downloads. No bank request or deployment was performed.

The Python suite was run separately for this result and then included in `test:all`. The installed Stellar SDK 17.1.0 types confirm `GetLatestLedgerResponse.closeTime`; that compatibility concern required no code change. Native escrow (29), compiled-WASM escrow (29) and the local WASM rehearsal (1) below remain imported integration evidence and were not rerun during this intake.

For later validation, prepare the pinned extension and benchmark assets before running the combined root, policy/protocol/wallet-RPC, Python preparation and syntax checks. A root test exit code of zero with missing-asset skips is not release validation; require zero skips. The native and compiled-WASM escrow suites and local WASM rehearsal are separate gates whose source/artifact provenance must remain explicit. No bank request or cloud operation is needed for these local gates.

The [combined intake record](../evidence/release/tls-intake-checks.json) identifies source parents, runtime preparation and check scope. Prettier passed for the combined tree.

## Integration-source results

| Check                                          | Result                                                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:all`                             | 49 root tests, 51 policy tests, 11 canonical protocol tests and 11 wallet/RPC/journal tests passed                                                             |
| Policy snapshot sync                           | Canonical encoder and vectors are byte-identical to the policy copies                                                                                          |
| Escrow native suite                            | 29 passed                                                                                                                                                      |
| Escrow compiled-WASM suite                     | The same 29 passed against the reviewed optimized artifact                                                                                                     |
| `npm run rehearse:local -- --rebuild --record` | 1 app-model → policy → compiled-WASM integration test passed; rebuilt artifact hash matched                                                                    |
| `npm run check`                                | 49 JavaScript modules/inline scripts passed syntax checks                                                                                                      |
| `npm run format:check`                         | Prettier scope checked; canonical protocol/interface/artifact bytes excluded intentionally                                                                     |
| Browser rehearsal                              | Seller funds whole offer → buyer reserves → lock confirms before instructions → failed proof holds → retry → simulated receipt; reload retains completed trade |
| Responsive review                              | Desktop receipt, 390px receipt and 320px seller state reviewed; no horizontal overflow, console warnings or errors observed                                    |
| Static build                                   | Seven allowlisted files, synthetic manifest, hashes and restricted headers; no deployment                                                                      |

The [recorded rehearsal](../evidence/release/local-wasm-rehearsal.json) pins runtime source revision `006ab023e4d44600d03f320f220457e5b5545f0e`, clean rehearsal source hashes and WASM SHA-256 `8940569853b21a957fc5a81402666e95ed75f054ce2223926231ffc2c0c506dd`. Later documentation/format-only commits do not change that runtime. Local final balances: buyer 220,000,000 atoms; escrow and seller zero. Replay transfers nothing further.

The harness mocks actor authorization for synthetic wallets; the escrow's separate native/WASM suites check missing/wrong actor authorization. The actual policy Ed25519 signature is verified inside WASM. Wallet/RPC tests use the actual SDK with mocked RPC/wallet responses and real disk SQLite; they are not network integration tests.

Tooling: Node 26.7.0, Rust 1.99.1, Stellar CLI 28.1.0, Soroban SDK 29.0.1, JS Stellar SDK 17.1.0 and Freighter API 6.0.1. Existing ignored dependency/build caches were reused. Rustfmt is unavailable; Rust formatting was not mechanically checked. Imported component documentation/test scripts received formatting only; frozen encoder, vectors, interface and WASM retain their hashes.

Public proof observations retain their own dates and attribution in [status](status.md). The sanitized cloud source is now imported, with its separate sequence of 85-, 90- and 93-test checkpoints, parser/QuickJS findings and deployment/uptime checks preserved in [proof verification history](proof-verification.md). The latest proof-workstream run reported 93 passed, zero skipped and 37 syntax checks; it is not the merged candidate’s result.

No bank login, new payment, authenticated proof attempt, contract deployment or network transaction was performed by this release integration lane. The imported historical proof deployment does not deploy the combined app. Bank tests remain paused, and the payment gate remains `NOT_CLEARED`.
