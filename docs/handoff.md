# Development handoff

Objective: finish one Revolut-to-Stellar P2P trade, starting from the payment-proof gate.

The packaged source lives in the private `vmichalik/stellar-p2p` repository on `main`. Use `git rev-parse HEAD` and `git status --short` to identify the exact revision and local changes before resuming. This is a new repo containing the prototype baseline; its initial commit date is the packaging date, not evidence that every experiment happened that day.

The verifier/build host is the remote Mac mini. The current browser client is the owner's MacBook Pro, confirmed on 25 October 2026. Earlier Windows results remain historical. These devices do not share browser profiles, local files or loopback addresses.

The earlier private test services are separate from this checkout. Packaging this repo does not move, restart or publish them. Their runtime configuration and logs stay outside Git. Recheck readiness before reusing a service; an old command-session handle does not prove it is running.

## First actions in this checkout

1. Run `npm test` and `npm run check`.
2. Read [status](status.md) before making a live proof claim.
3. Prepare the pinned verifier and HTTPS route using [setup](setup.md).
4. Read the latest MacBook and cloud results below; repeat checks after a device, runtime or route change.
5. Read the failed cloud attempt below. Infrastructure is frozen; isolate the failure after disclosure approval before requesting another authenticated attempt.

## Current boundary

Public extension proof passed on the MacBook on 25 October 2026 against both the Mac mini and Fly verifiers, with acceptance independently confirmed in each verifier log. The public cloud setup diagnostic is live, and its MacBook comparison has completed. Authenticated TLSNotary payment proof remains unresolved. No payment-policy signer, TLSNotary-compatible contract, deployed escrow or settlement is established. The earlier Reclaim code is archived and should not be used as the active proof service.

## Current continuation: 25 October 2026

Execution host: Mac mini. The original `stellar-p2p` checkout on `main` became inaccessible to the agent because of macOS folder permissions after a session switch. Its earlier local documentation/evidence changes were preserved. Existing Git credentials could read the canonical private repo, so work continued in an isolated temporary checkout on branch `codex/public-proof-benchmark`, based on `807412686da2cdad494ee284675dbefc35110257`. Runtime selectors, absolute paths, process IDs and cloud resource IDs are kept in ignored `.private/continuation.json`. The repo remains private.

The owner reported `PUBLIC_PROOF_COMPLETED; HTTP 200` on the MacBook. The Mac mini verifier confirmed the server name, disclosed transcript ranges and `session_completed` delivery at 10:46:50 UTC. One approved authenticated response-shape attempt then hit `MPC_SETUP_TIMEOUT` before a bank request. A separate MacBook browser setup completed in 36.2 seconds; 13.0 MB remained queued at the 30-second deadline. No response shape was established by that failure.

The owner requested a 60-second extension setup watchdog. A labelled local copy was prepared from the checksum-verified official release and sent to the MacBook through private Taildrop. Installation on that MacBook has not been verified. The reproducible preparer and eleven real-bundle watchdog tests are now included; cryptographic assets and other deadlines are unchanged. Launcher error handling recognizes both the original 30-second and local 60-second setup errors.

The owner then authorized a cloud VM and a public endpoint for a third-party demo by 26 October. No GCP project/account was configured. A temporary Vercel Paris VM was tested and stopped; its link-local-only network prevented the proposed VPN path, and its short session lifetime was unsuitable for the demo. No cloud VPN node was registered. The owner explicitly removed the VPN requirement. Fly browser sign-in completed through its normal CLI flow; no credential or completion code is recorded here.

The public bank-free diagnostic is hosted at [the Fly setup page](https://stellar-p2p-proof-vijay.fly.dev/benchmark/). Fly's current region list lacks Madrid, so the deployment uses Paris (`cdg`). One VM is running with two shared vCPUs and 4 GiB RAM, auto-stop disabled and a passing health check. The account rejected the requested performance CPU class; no account upgrade was made. HTTPS/WSS reaches the cloud directly and requires no Tailscale client.

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

This mitigation does not fix the extension's finite callback-ID space or establish successful bank verification. The shipped SDK can also emit a runtime-disposal assertion below the allocation limit; the full-host tests distinguish operation health from that separate teardown problem. The extension package and deployed Fly image remain unchanged. Final local checks: 93 tests passed, zero skipped; syntax checks passed for 37 modules and inline scripts. See [verification](verification.md) for scope and limitations.

## Completed bank-free comparison

The owner ran alternating trials from the same MacBook browser/network with eight worker threads. All six passed within the original 30-second extension deadline:

| Target    | Setup durations     | Median |
| --------- | ------------------- | ------ |
| Mac mini  | 16.9s, 17.9s, 18.4s | 17.9s  |
| Fly Paris | 16.4s, 17.4s, 24.5s | 17.4s  |

The cloud median was about 3% lower in this sample. Three trials per host do not establish a meaningful speed advantage or better tail latency. Public reachability is the reason to retain the cloud host. These comparison trials used the earlier image `sha256:59770e9ed678081a5ec940bcf7b3f6c2fb30e15bdac1bd4d20a482e87cf6a55e`. Separate automated isolated-Chrome infrastructure checks from the mini passed at 3.473s locally and 6.499s against that earlier Fly image; those are not MacBook comparison results. The live oversized-registration rejection was also checked on that earlier image.

The public default button runs one fixed cloud check. The owner comparison is inside Details and needs the private mini route for its mini trials. Both modes use checksum-pinned runtime assets and 4096-byte sent / 16384-byte received budgets; neither makes a bank request. Setup success never clears the payment gate.

## Remaining work

The local callback-allocation mitigation is tested and ready for review. Deployment remains pending under the owner's infrastructure freeze; a proposed deployment would change only the application plugin on the existing Fly host. The failure after disclosure approval remains unresolved. Do not retry bank requests to discover the response schema, change selectors without local response evidence, or treat the new parser regressions as a fix for this incident. The public setup and public extension checks are not a completed P2P trade or payment-proof demo.

The [cloud response-only page](https://stellar-p2p-proof-vijay.fly.dev/response-check/) remains available, but a new authenticated attempt is not the next diagnostic step. It displays the verifier and exact disclosure, requires explicit account-owner consent and consumes that consent after each extension execution. Its plugin exposes only **Check response only** and rejects payment-field mode even through an explicit exported-function call. Read [setup](setup.md) before any later owner-approved use.

After the bank response is independently verified, the payment-policy signer and escrow milestones in [the build plan](build-plan.md) remain. Do not release funds from browser callbacks, screenshots, field-presence summaries or setup results. Keep the Fly VM running for the intended public demo and review its lifetime after the submission; no shutdown schedule was created.

## Keeping the repo clean

Use synthetic fixtures. Keep credentials, bank identifiers, proof transcripts and runtime logs in private local storage. Review the staged content before every push; an ignore rule cannot protect a file already tracked in Git. Record new live checks with the actual host, date, result and limitations, without publishing private account details.

For an authenticated response check, do not dump the verifier log into tool output or chat. The approved request path contains a private transaction ID. Parse logs within the execution environment and expose only the allowlisted status, content category, JSON root type, field names and verification outcome. Never copy the raw request path or transcript into evidence files.
