# Packaging checks

Run on 25 October 2026 on the remote Apple Silicon Mac mini. These checks validate the packaged source and synthetic fixtures. They do not repeat the historical public proof or establish an authenticated payment.

| Check                                             | Result                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm test`                                        | 32 active TLSNotary tests passed                                                                            |
| `npm run check`                                   | 18 JavaScript modules and inline scripts passed syntax checks                                               |
| `npm run format:check`                            | All files in Prettier’s scope passed                                                                        |
| `npm run test:legacy`                             | 9 synthetic JavaScript signature tests passed                                                               |
| Archived contract native tests                    | 3 passed; compiled-WASM test skipped in this default run                                                    |
| Archived compiled-WASM test, run explicitly       | 1 passed, including rejection of changed claim fields                                                       |
| `stellar contract build --locked` for the archive | Built and optimized the synthetic-test contract                                                             |
| Pinned tooling preparation, offline               | Source and runtime hashes checked; patch applied; repeat run completed                                      |
| Python preparation scripts                        | Passed bytecode compilation                                                                                 |
| Staged content review                             | No private data directories, machine-specific addresses, known bank identifiers or credential markers found |

Tool versions: Node.js 26.7.0, Rust 1.99.1 and Stellar CLI 28.1.0. Rust checks reused the existing local dependency/build cache; the compiled module was copied to the archive’s expected test location. The setup guide gives the normal build commands for a fresh checkout.

The initial direct Cargo WASM build failed because this SDK requires Stellar CLI spec preparation. The archive instructions now use the supported CLI build, which passed. No protocol timeout, trust setting or verifier protection was relaxed.

The archived unified-diff file retains the single-space context lines required by that format. Source whitespace checks exclude that patch artifact. No downloaded tooling, native binaries or WASM modules are committed.

No bank login, new payment, live proof attempt, contract deployment or escrow release was performed while packaging this repo. The prior private test services were left in place.
