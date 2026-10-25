# Release checks

Run on 25 October 2026 on the remote Apple Silicon Mac mini. These results cover the integrated local candidate. They do not establish an authenticated bank payment or network settlement.

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

Public proof observations retain their own dates and attribution in [status](status.md). The proof workstream's current cloud source is not imported. No bank login, new payment, authenticated proof attempt, contract deployment or network transaction was performed by this release integration lane.
