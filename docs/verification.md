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

## Public-host continuation, 25 October 2026

Work continued on the Mac mini in an isolated checkout on `codex/public-proof-benchmark`, based on `807412686da2cdad494ee284675dbefc35110257`; the original Documents checkout was denied by macOS folder permissions. This continuation adds a reproducible Fly deployment, public setup comparison, a labelled 60-second extension diagnostic and a consent-gated response-only launcher. The original checkout was preserved. Current checkout location, local revision, runtime artifacts and resource selectors are in ignored `.private/continuation.json`.

| Check                             | Result and scope                                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                        | 85 passed, zero skipped, with ignored released-runtime and extension assets prepared. Includes eleven actual-bundle watchdog tests and five response-only consent/disclosure tests.                                                                                                  |
| `npm run check`                   | 34 JavaScript modules and inline scripts passed syntax checks.                                                                                                                                                                                                                       |
| `npm run test:benchmark-prep`     | Eight tests passed for pinned tooling, archive handling, exact configuration and preservation of existing output.                                                                                                                                                                    |
| Independent response-only review  | Sixteen focused synthetic tests passed; no blocking findings. Consent, forced response mode, callback sanitization and unchanged transport limits were reviewed.                                                                                                                     |
| Pinned source staging             | Prepared offline from checksum-verified archives; prior deployment stage preserved. Cryptographic verifier source and Cargo.lock remain pinned.                                                                                                                                      |
| Public extension proof on MacBook | Owner reported HTTP 200 against Fly. The verifier independently confirmed the server identity, authenticated reveal ranges and delivery of `session_completed` at `2026-10-25T12:34:28.445088Z`, on image `sha256:9bb965a489c295f253b234c4ce748afe478da5ce4fc4664458ea983ea652be14`. |
| Same-MacBook comparison           | All six foreground setups passed within 30 seconds: mini median 17.9s; Fly median 17.4s. These trials used the earlier `59770e…` cloud image. They establish setup performance only.                                                                                                 |

The response-only deployment, image `sha256:2c6da2b1669d8592fe072439a225872d6530996fbb23b33a41bddb04c7ce6b89`, passed HTTPS health, exact-route, fresh-nonce and forced-mode checks at 12:49 UTC. An isolated Chrome check using a synthetic extension API confirmed required consent, consent consumption and sanitized callback rendering. It did not execute the bank plugin, open a bank page or perform a real extension proof. Formatting and source whitespace checks passed; unified patch artifacts retain their required context spaces.

The initial default-sandbox test run could not open synthetic loopback listeners. Rerunning with normal listener permissions passed. A fresh checkout without prepared assets skips the released-runtime and bundle integration cases; it is not equivalent to the zero-skip run above. Archived Reclaim checks were not repeated because their source was unchanged.

No authenticated bank response, payment-policy acceptance, escrow deployment or release is established by these checks. A live authenticated response-shape check still needs the owner's approval for the cloud verifier and exact disclosure, including the private transaction ID in the request path. Keep that path and raw verifier transcript out of tool output, Git and chat.
