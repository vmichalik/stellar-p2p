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

No authenticated bank response, payment-policy acceptance, escrow deployment or release is established by these checks. A subsequent owner-approved cloud attempt failed after disclosure approval; its sanitized observations are in [the handoff](handoff.md#failed-cloud-response-check-25-october-2026). Keep the private request path and raw verifier transcript out of tool output, Git and chat.

## Parser coverage correction, 25 October 2026

The 85-test result above did not establish compatibility between the real bank response and the shipped parser. Plugin tests replaced `prove()` with a mock and their HTTP fixture omitted framing headers. That fixture now includes a byte-counted `Content-Length`.

Five new tests in `tlsn/response-parser.test.mjs` execute the actual released `compute_reveal` WASM against synthetic transcripts. The assets are hash-checked before loading; the crypto WASM digest is `bb3c73628f088867a1f99291275b56a379ce44fd239efca9445fb5908a97e318`, identical to the extension's packaged crypto WASM. SDK handler actions are canonicalized to the WASM enum representation. No network, MPC execution or bank response is involved.

- Identity responses with `Content-Length` and correctly chunked responses pass.
- A body without `Content-Length` or `Transfer-Encoding` is rejected, even when only HTTP status is selected.
- A gzip body is rejected as invalid UTF-8, also for status-only selection.
- The actual response-shape handlers disclose synthetic root markers and allowed field names without financial values, and reject the unsupported fixtures.

The owner confirmed the failed bank attempt displayed a disclosure preview and they approved it. That preview follows parsing, so these parser limitations are not the established cause of the observed failure. They remain useful regression coverage. The HTTP metadata from the actual response was unavailable.

After this correction, `npm test` passed **90 tests with zero skips** using the prepared released assets. `npm run check` passed **35 modules and inline scripts**. Runtime code, the extension package and the deployed Fly image were unchanged.

## Released QuickJS callback failure reproduction

The owner's existing log included `QuickJSContext had no callback with id -32768`. `tlsn/extension-quickjs.test.mjs` reproduces this exact error using the checksum-verified official extension archive, its released offscreen module implementations and shipped QuickJS WASM. Only extension startup is removed; the sandbox has no Chrome, fetch or WebSocket API. No dependency installation is needed.

The host allocator starts at `-32768` and increments a JavaScript number. At allocation 65,536 the resulting ID 32768 becomes -32768 across the native callback bridge, which has no corresponding callback. At allocation 65,537 it becomes -32767 and calls the first callback. This deterministic synthetic regression establishes the released runtime bug, not the ordering or cause of the live connection failure. QuickJS WASM digest: `a5920bb5789c1ad1236c54b0146a2b3a2eb262050e2baea0388bce574a2632bb`.

The real MacBook allocation count was not recorded. The callback-boundary reproduction above does not establish a fix or permission for another authenticated attempt.

## Local plugin mitigation and final checks

The plugin now retains only the newest matching transfer and skips captured-header serialization while pending. `tlsn/extension-plugin-runtime.test.mjs` executes the actual rendered response-only plugin through the shipped host, evaluator, serializer and QuickJS. Captured headers are synthetic objects created in the serializer's own realm. Worker startup, WebSocket and fetch are prohibited. Only the final `onProve` operation is synthetic; callback allocation, plugin evaluation and disclosure UI use released code.

Two tests pass: latest selection and bounded idle callback growth; pending behavior and explicit disclosure approval/rejection. With either one or twenty captured transfers, the patched plugin allocates 87 callback IDs per idle main call and 9 per pending call. Pending rendering performs no captured-header serialization. Selected transfer, explicit-click behavior and 4096/16384 proof budgets are preserved. The prior plugin allocated 277 per main call with twenty entries in the temporary reproduction.

These checks assert runtime health during operation. The shipped SDK can separately log its `JS_FreeRuntime` disposal assertion in the synthetic host even below the callback limit, so teardown is not claimed fixed. The finite callback-ID limit also remains. The application mitigation is local and undeployed; it does not establish a completed live proof.

Final local run: **93/93 tests passed, zero skipped**, and **37 JavaScript modules and inline scripts** passed syntax checks. Independent review found no blocking issue and passed seventeen focused tests plus a deferred-proof selection check. The deployed image, extension package, protocol budgets and infrastructure are unchanged.
