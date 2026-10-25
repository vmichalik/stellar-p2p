# Verification records

## 25 October: host integration and architecture handoff

The final local regression run passed **224 JavaScript tests**: 125 root, 55 policy, 11 protocol and 33 integration tests. The integration group includes browser transport, HTTP guards, one-hour capability expiry, private offer binding, deployment history/code verification, consistent-ledger readers, event indexing, durable authorization references, transaction journaling and recovery. No tests were skipped. Ten Python preparation tests, 98 JavaScript/inline syntax checks and scoped Prettier checks also passed.

A fresh app-model → policy → compiled-WASM rehearsal passed against the unchanged reviewed artifact. The new TLSNotary privacy variant passed offline locked Cargo check in 19.41 seconds, after exact archive/patch/source hashes were checked. This was a compile check, not a release build or a running-service test. No existing proof service was restarted.

The [disposable testnet rehearsal](../evidence/release/testnet-rehearsal-2026-10-25.json) passed at `2026-10-25T19:04:33.770Z`. It deployed the reviewed escrow and a synthetic PLTEST asset, released 220,000,000 atoms, rejected resubmission of the same claim, and mutually resolved a second order with 110,000,000 atoms to each party. Receipts matched the confirmed contract, order, transaction and token events. A separate read verified the creation transaction, starting ledger and actual deployed WASM hash. This used fresh programmatic keys and synthetic payment evidence, without a bank request or real USDC.

An earlier disposable recovery attempt failed because editing the SDK's decoded operations did not serialize the signed authorization. The adapter now rebuilds the operation and checks the entries through XDR before preparation, after preparation and after wallet signing. The passing network run used that fix. Earlier failed test-only setups were preserved privately and were not retried as the same actions.

Browser smoke checks loaded the real private host with submission disabled, removed its access fragment, read testnet order 0 as `Released` through HTTP → RPC, and returned `NOT_CLEARED` from the policy route. No wallet prompt or bank flow was initiated. The architecture study has seven rendered SVG diagrams, source links, contract explanations and judge Q&A. Its state/funding arrows were corrected during visual review. All SVG text fits within its figure, and no console warnings/errors were observed in the study. The guide is self-contained and makes no external asset requests.

The public app/media are unchanged, pinned to the [existing narrative release](../evidence/release/public-narrative-2026-10-25.json). The new source is a local development candidate. Authenticated Revolut proof, live normalization, Freighter UI signing, real USDC and production operation remain unvalidated. The release gate stays `NOT_CLEARED`.

## Historical checks

The records below describe earlier candidates before the host/testnet work above. Their deployment and network limitations refer to those checkpoints.

The first table records the initial candidate `c8f4475` on 25 October 2026, before the domain/TLS-source follow-up. It is retained as historical evidence. Current domain checks are below; no result establishes an authenticated bank payment or network settlement.

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

Public proof observations retain their own dates and attribution in [status](status.md). The reviewed cloud source snapshot is now integrated locally; its deployment observations remain source-specific. No bank login, new payment, authenticated proof attempt, contract deployment or network transaction was performed by this release integration lane.

## Domain and TLS-source follow-up

The local TLS bundle through `2c98f8e` passes all released-runtime fixtures with the pinned archive staged privately: 125 root tests passed, zero skipped/failed. Policy follow-up `668adfc` adds four presentation cases: 55 policy tests passed. The 11 protocol and 11 wallet/RPC cases remain passing. Eight Python preparation tests pass. The custom-origin renderer rejects noncanonical origins; no running Fly configuration was changed.

Workers Static Assets dry run passes using installed Wrangler 4.152.0. Ten allowlisted app assets plus four generated files form the current build. Shared security headers, canonical aliases preserving path/query, metadata, social image and synthetic labels are checked. Built-page browser review found expected canonical/social tags, the operational Fly help link and only local script/style/icon resources, with no warning/error observed. Final polish `572f2b9` and both recovery corrections are integrated. The final full run passes 202 JS tests, zero skipped/failed. The built-page smoke passes, and the exact 14-file inventory is in ignored `.private/release/domain-bundle.json`. Publication/reachability remain with the coordinator.
