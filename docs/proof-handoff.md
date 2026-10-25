# TLS proof handoff

Objective: preserve the TLS proof workstream’s source, diagnosis and boundaries for the integrated Pactlane candidate. The app, policy and local escrow work are described in [the main handoff](handoff.md).

This sanitized handoff comes from private `vmichalik/stellar-p2p`, branch `codex/public-proof-benchmark`, snapshot `2c98f8e86ee3fb6c9f89c14883c43b0a0d38f03a`, based on `807412686da2cdad494ee284675dbefc35110257`. Source intake includes public hosting/response diagnostics at `38eb912a6cc11511e588ea03c5a53655f387abf0`, plugin mitigation at `f433423e62eac2ed7d2fae8430c6bab2da1443c1`, and deployment/uptime evidence at `2c98f8e`. These are historical workstream observations, not new checks of the combined candidate. Use `git rev-parse HEAD` and `git status --short` for its current local revision and changes.

The verifier/build host is the remote Mac mini. The current browser client is the owner's MacBook Pro, confirmed on 25 October 2026. Earlier Windows results remain historical. These devices do not share browser profiles, local files or loopback addresses.

The earlier private test services are separate from this checkout. Packaging this repo does not move, restart or publish them. Their runtime configuration and logs stay outside Git. Recheck readiness before reusing a service; an old command-session handle does not prove it is running.

## Current boundary and continuation

The source has been imported into the local integrated candidate; this does not deploy the combined app or change the existing proof service. Read [status](status.md), [proof verification history](proof-verification.md) and [setup](setup.md) before continuing. Preserve the pinned runtime and prepare its ignored assets before running the release checks; missing-runtime skips do not establish coverage.

Public extension proofs passed from the MacBook against both the Mac mini and Fly verifiers on 25 October 2026. Authenticated TLSNotary payment proof remains unresolved and the release gate is `NOT_CLEARED`. The integrated app, payment-policy signer and escrow have local synthetic/WASM evidence; live payment normalization, deployed escrow and network settlement remain unestablished. The earlier Reclaim code is archived.

The owner later resumed one response-only attempt and one matched-capacity public check; both timed out during MPC setup. The newer sequence and proposed extension workaround below supersede the earlier pause-only continuation. No further authenticated attempt is authorized by this handoff; it requires the owner's applicable instruction and normal per-attempt consent/disclosure review.

## Latest continuation: setup timeout after the hosting repair

On 25 October, a response-only session registered at 15:27:42 UTC, reached the official extension's 30,000 ms `setupProver` timeout at client-displayed 15:28:12, and closed its control connection about 15:28:13. The same Fly instance remained running. The owner confirmed the MacBook stayed awake and the proof window visible. No completed bank TLS exchange, HTTP replay, parsing or disclosure was observed in this new attempt.

The supplied client export repeated 2,910 prior lines and appended 58 new lines. The earlier QuickJS callback overflow is historical in that export. The later still-borrowed-prover cleanup/disposal error follows the setup watchdog; it is not demonstrated to cause the setup delay. Keep this incident separate from the repaired 12:54 Fly trial shutdown.

Read-only comparison found the deployed response and public plugins, plus the failed session, use the same 4,096 sent / 16,384 received byte budgets, verifier pins and MPC settings. The owner then reported `Extension check: MPC_SETUP_TIMEOUT` from the existing public check. The public failure shows that authenticated transfer data is not required to reproduce this setup stall. It does not locate the bottleneck within client computation, transport or verifier processing. No further proof attempts were requested by the coordinator.

The owner initially declined the custom 60-second extension, then reopened that direction by proposing an auditable Pactlane fork. The TLS thread subsequently published [Pactlane TLSNotary v0.1.0.1501-pactlane.1](https://github.com/vmichalik/pactlane-tlsnotary/releases/tag/v0.1.0.1501-pactlane.1), a GitHub prerelease at `8d69fcc69b89b60c7ba43d098b0f98c62364b1e0`, on 25 October at 15:50:28 UTC. GitHub publication and matching artifact digests were independently checked. The published ZIP is 7,377,949 bytes, SHA-256 `27297815b4f0484f92d8fb74637fef2bf291f6fdaebbba5d4e8e833103dda761`. The earlier default output ZIP is stale; use the release asset and this checksum.

The fork changes the worker watchdog and manifest labeling; all 25 other extension payload files, including WASM, match upstream. It preserves the inherited permissions and does not fix cancellation, borrowed-prover cleanup or the callback limit. Source provenance and branding are now recorded; full dependency-notice coverage was not established by this review. This is an experimental workaround, not a speed fix or proof-completion result.

The TLS thread reports eleven offline watchdog tests and Taildrop to the MacBook. This integration did not rerun those tests or verify receipt/installation on the receiving device. A successful public proof with the published package remains pending. The next existing instruction is one public connection check after installation, with unchanged 4,096/16,384 budgets, then stop on failure and reconcile verifier completion. Future authenticated testing remains a separate owner-authorized action with normal per-attempt consent/disclosure review.

Continue product and submission preparation while that check awaits the owner. Do not add parser guesses, enlarge the diagnostic matrix, weaken the payment gate or represent a public setup result as accepted payment evidence.

## Current continuation: 25 October 2026

Execution host: Mac mini. The original `stellar-p2p` checkout on `main` became inaccessible to the agent because of macOS folder permissions after a session switch. Its earlier local documentation/evidence changes were preserved. Existing Git credentials could read the canonical private repo, so work continued in an isolated temporary checkout on branch `codex/public-proof-benchmark`, based on `807412686da2cdad494ee284675dbefc35110257`. Runtime selectors, absolute paths, process IDs and cloud resource IDs are kept in ignored `.private/continuation.json`. The repo remains private.

The owner reported `PUBLIC_PROOF_COMPLETED; HTTP 200` on the MacBook. The Mac mini verifier confirmed the server name, disclosed transcript ranges and `session_completed` delivery at 10:46:50 UTC. One approved authenticated response-shape attempt then hit `MPC_SETUP_TIMEOUT` before a bank request. A separate MacBook browser setup completed in 36.2 seconds; 13.0 MB remained queued at the 30-second deadline. No response shape was established by that failure.

The owner requested a 60-second extension setup watchdog. A labelled local copy was prepared from the checksum-verified official release and sent to the MacBook through private Taildrop. Installation on that MacBook has not been verified. The reproducible preparer and eleven real-bundle watchdog tests are now included; cryptographic assets and other deadlines are unchanged. Launcher error handling recognizes both the original 30-second and local 60-second setup errors.

The owner then authorized a cloud VM and a public endpoint for a third-party demo by 26 October. No GCP project/account was configured. A temporary Vercel Paris VM was tested and stopped; its link-local-only network prevented the proposed VPN path, and its short session lifetime was unsuitable for the demo. No cloud VPN node was registered. The owner explicitly removed the VPN requirement. Fly browser sign-in completed through its normal CLI flow; no credential or completion code is recorded here.

At that checkpoint, the public bank-free diagnostic was deployed at [the Fly setup page](https://stellar-p2p-proof-vijay.fly.dev/benchmark/). The region list then lacked Madrid, so it used Paris (`cdg`), with one two-shared-vCPU / 4-GiB VM, auto-stop disabled and a passing point-in-time health check. The account rejected the requested performance CPU class; the agent made no account upgrade. The owner's later PAYG upgrade and bounded uptime observation are recorded below. HTTPS/WSS reached the cloud directly without a Tailscale client; current availability has not been rechecked by this source intake.

The public-extension deployment used image `registry.fly.io/stellar-p2p-proof-vijay@sha256:9bb965a489c295f253b234c4ce748afe478da5ce4fc4664458ea983ea652be14`. This is the pinned verifier plus documented transport/target restrictions and a public registration-budget guard, not an unmodified upstream binary. Cargo.lock, cryptographic verification code, proof budgets and verifier deadlines are preserved. Webhooks are disabled. Check ignored continuation metadata and the live machine before assuming this remains the deployed image.

The owner then ran [the cloud extension check](https://stellar-p2p-proof-vijay.fly.dev/extension-check/) on the MacBook and reported `PUBLIC_PROOF_COMPLETED; HTTP 200`. Fly's verifier independently confirmed the `app.revolut.com` server identity, authenticated reveal ranges and delivery of `session_completed` at 12:34:28.445088 UTC on that image. The check used only the public request line and HTTP status. It made no authenticated bank request and established no payment fields.

The later response-only deployment uses image `registry.fly.io/stellar-p2p-proof-vijay@sha256:2c6da2b1669d8592fe072439a225872d6530996fbb23b33a41bddb04c7ce6b89`. At 12:49 UTC, the single VM was started with a passing health check. Its new routes, fresh script nonce, forced response mode and denial of raw full-plugin routes were checked over HTTPS. An isolated Chrome check with a synthetic extension API confirmed consent and sanitized rendering. The owner subsequently ran one authenticated attempt on this image, described below; the earlier accepted public proof retains its own image provenance.

## Failed cloud response check, 25 October 2026

The owner ran the consent-gated response-only check on the MacBook and later confirmed that the disclosure preview appeared and they approved it. In the pinned extension, this preview follows successful response parsing. Framing and compression are therefore not the demonstrated failing stage for this attempt. The original Network entry is unavailable, so its HTTP status, framing, encoding and JSON structure remain unknown to this project.

Sanitized Fly observations: the session registered at 12:53:55 UTC; the bank TLS connection completed and native verification began at 12:54:24; the control connection reset at 12:54:26 while the server was waiting for `reveal_config`. No disclosure configuration, authenticated response ranges or `session_completed` result was observed for this attempt. Encrypted transport byte counts do not establish an HTTP result.

The owner's existing client log contains two untimestamped SDK sequences. One finalized; the other received a response, reached `Committed`, entered `reveal()` and then reported `WebSocket is closed`. These entries cannot independently be assigned to a server session. The released extension sends the control configuration before calling `reveal()`, but does not wait for server acknowledgement; a client reveal event does not establish server receipt. Released cleanup calls `free()` and does not initiate a fallback reveal.

The same client log later reports `QuickJSContext had no callback with id -32768`, repeated `Lifetime not alive` errors, plugin termination at 12:58:42, and forced disposal after a 30-second callback-drain timeout at 12:59:12. The generic overlay stayed on “Generating proof…”. The pinned cleanup path awaits a worker RPC without a deadline, which can delay an error result; that source finding alone does not prove it caused this incident.

The exact callback error was reproduced offline with the shipped QuickJS JavaScript and WASM: host-function allocation 65,535 succeeds, allocation 65,536 overflows its callback ID and produces `-32768`, and allocation 65,537 invokes the first callback instead of the intended one. `tlsn/extension-quickjs.test.mjs` retains this regression. No proof or network operation was involved. This confirms an extension runtime defect; the failed MacBook execution's allocation count and its causal relationship to the earlier connection reset remain unknown.

The earlier plugin tests mocked `prove()` and accepted an unframed HTTP fixture. That fixture now has a byte-counted `Content-Length`. Five additional tests execute the checksum-pinned released WASM parser against synthetic transcripts: framed identity and chunked responses pass; unframed and gzip responses fail even for status-only disclosure. The actual response-shape handlers are also exercised. These are parser compatibility tests, not a reproduced bank failure or cryptographic proof.

A narrow transport check from Node.js on the Mac mini kept an unregistered WebSocket open on the existing Fly `/session` route for 45 seconds after upgrade. No proof was registered and no bank connection was opened. A simple 30-second idle cutoff was not reproduced on that path; this does not reproduce the MacBook's active proof or rule out its connection failure.

A local plugin mitigation retains only the newest matching transfer from the sorted selector and avoids serializing captured headers while a proof is pending. Two tests run the actual rendered plugin through the checksum-verified shipped host, evaluator, serializer and QuickJS. With either one or twenty synthetic captured transfers, idle main calls allocate 87 callbacks and pending calls allocate 9; pending calls perform no captured-header serialization. The earlier implementation allocated 277 callbacks per main call with twenty entries in the temporary reproduction. Selection remains stable, no automatic proof starts, and the non-null pending UI preserves explicit Approve/Reject in the host disclosure overlay. The proof result is synthetic; no MPC or bank request is run by these tests.

This mitigation does not fix the extension's finite callback-ID space or establish successful bank verification. The shipped SDK can also emit a runtime-disposal assertion below the allocation limit; the full-host tests distinguish operation health from that separate teardown problem. At completion of this local work the extension package and deployed image were unchanged. Local checks: 93 tests passed, zero skipped; syntax checks passed for 37 modules and inline scripts. See [proof verification history](proof-verification.md) for scope and limitations.

## Approved plugin deployment and identified shutdown

The owner explicitly approved “Deploy plugin only”, keeping bank tests paused. On 25 October, source commit `f433423e62eac2ed7d2fae8430c6bab2da1443c1` was deployed to the existing Fly VM as image `sha256:eb0e1d37fdc2883a2a21ea2c0d47fd8a71d5bc3550edef28c63243e217e83fb6`. Comparing the complete old and new build manifests showed exactly one changed build file: `revolut.plugin.mjs`. The deployment updated the existing machine only. Its region, CPU, memory, environment, services, restart policy and health configuration were unchanged. No extension package, billing setting or bank test was changed.

At 13:31 UTC, public HTTPS checks confirmed health/version pins, exact served plugin content, forced response-only mode, fresh CSP nonces and denial of raw full-plugin routes. An isolated Chrome check with a synthetic extension API confirmed required consent, consent consumption and sanitized results. Machine health was passing at 13:31:57 UTC. These are deployment checks, not a real authenticated proof.

During deployment preparation, Fly machine history showed a requested VM stop at `2026-10-25T12:54:26.857Z`, matching the earlier control-connection failure. Existing platform logs explicitly report **Trial machine stopping** at 12:54:26 UTC and again at 13:26:52 UTC. The latter stop occurred exactly five minutes after the machine started. This identifies a verifier-host shutdown at the failing instant and explains the lost connection; it supersedes the earlier unknown-cause assessment for that server disconnect. It does not prove that the separate client callback/disposal errors are fixed.

[Fly's trial documentation](https://docs.fly.io/about/free-trial) confirms that trial machines stop after five minutes and that adding a payment method removes the trial limits and starts billing. The application was configured with auto-stop disabled, but that did not prevent the trial-enforced shutdown. The earlier 45-second socket check tested connection age, not survival beyond the VM's five-minute lifetime. No payment method was added by the agent.

The owner then reported upgrading to PAYG and adding a card. The boot that began before that report still stopped under the trial timer at 13:36:27 UTC. The agent started the same stopped VM once, without changing its configuration. That start completed at `13:38:36.916Z`. At `13:45:08.707784Z`, the same instance had run continuously for **391.5 seconds**, with no intervening stop/restart and a final HTTP 200 health response. This bank-free check passed beyond the former five-minute cutoff. It registered no proof session and made no bank request; it is a finite uptime observation, not a guarantee of indefinite availability or payment verification.

## Completed bank-free comparison

The owner ran alternating trials from the same MacBook browser/network with eight worker threads. All six passed within the original 30-second extension deadline:

| Target    | Setup durations     | Median |
| --------- | ------------------- | ------ |
| Mac mini  | 16.9s, 17.9s, 18.4s | 17.9s  |
| Fly Paris | 16.4s, 17.4s, 24.5s | 17.4s  |

The cloud median was about 3% lower in this sample. Three trials per host do not establish a meaningful speed advantage or better tail latency. Public reachability is the reason to retain the cloud host. These comparison trials used the earlier image `sha256:59770e9ed678081a5ec940bcf7b3f6c2fb30e15bdac1bd4d20a482e87cf6a55e`. Separate automated isolated-Chrome infrastructure checks from the mini passed at 3.473s locally and 6.499s against that earlier Fly image; those are not MacBook comparison results. The live oversized-registration rejection was also checked on that earlier image.

The public default button runs one fixed cloud check. The owner comparison is inside Details and needs the private mini route for its mini trials. Both modes use checksum-pinned runtime assets and 4096-byte sent / 16384-byte received budgets; neither makes a bank request. Setup success never clears the payment gate.

## Remaining work

The approved plugin-only mitigation is deployed, and the post-upgrade bank-free uptime check passed beyond the previous cutoff. Later response-only and public attempts hit the setup timeout described above; the payment gate remains unresolved. A future authenticated check needs the applicable owner authorization and normal per-attempt consent/disclosure review. Do not retry bank requests to discover schema, change selectors without local response evidence, or treat parser regressions, hosting checks and deployment checks as payment proof. The public setup and public extension checks are not a completed P2P trade or payment-proof demo.

The [cloud response-only page](https://stellar-p2p-proof-vijay.fly.dev/response-check/) was deployed; availability has not been rechecked by this source intake. A new authenticated attempt is not the next step in the local fork review. The page displays the verifier and exact disclosure, requires explicit account-owner consent and consumes that consent after each extension execution. Its plugin exposes only **Check response only** and rejects payment-field mode even through an explicit exported-function call. Read [setup](setup.md) before any later owner-approved use.

The payment-policy signer and escrow are implemented and rehearsed locally in the integrated candidate. After independently verified bank semantics are available, the live normalizer and authorized testnet path in [the build plan](build-plan.md) remain. Do not release funds from browser callbacks, screenshots, field-presence summaries or setup results. The proof owner intended to retain the Fly VM for the public demo and review its lifetime after submission; no shutdown schedule was created. Source intake does not authorize a service or billing change.

## Keeping the repo clean

Use synthetic fixtures. Keep credentials, bank identifiers, proof transcripts and runtime logs in private local storage. Review the staged content before every push; an ignore rule cannot protect a file already tracked in Git. Record new live checks with the actual host, date, result and limitations, without publishing private account details.

For an authenticated response check, do not dump the verifier log into tool output or chat. The approved request path contains a private transaction ID. Parse logs within the execution environment and expose only the allowlisted status, content category, JSON root type, field names and verification outcome. Never copy the raw request path or transcript into evidence files.
