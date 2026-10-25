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
5. Read the confirmed cloud public proof below, then revisit the authenticated response-shape check with owner approval for that verifier and disclosure.

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

The later response-only deployment uses image `registry.fly.io/stellar-p2p-proof-vijay@sha256:2c6da2b1669d8592fe072439a225872d6530996fbb23b33a41bddb04c7ce6b89`. At 12:49 UTC, the single VM was started with a passing health check. Its new routes, fresh script nonce, forced response mode and denial of raw full-plugin routes were checked over HTTPS. An isolated Chrome check with a synthetic extension API confirmed consent and sanitized rendering. No real authenticated extension check was run on this image; the earlier accepted public proof retains its own image provenance.

## Completed bank-free comparison

The owner ran alternating trials from the same MacBook browser/network with eight worker threads. All six passed within the original 30-second extension deadline:

| Target    | Setup durations     | Median |
| --------- | ------------------- | ------ |
| Mac mini  | 16.9s, 17.9s, 18.4s | 17.9s  |
| Fly Paris | 16.4s, 17.4s, 24.5s | 17.4s  |

The cloud median was about 3% lower in this sample. Three trials per host do not establish a meaningful speed advantage or better tail latency. Public reachability is the reason to retain the cloud host. These comparison trials used the earlier image `sha256:59770e9ed678081a5ec940bcf7b3f6c2fb30e15bdac1bd4d20a482e87cf6a55e`. Separate automated isolated-Chrome infrastructure checks from the mini passed at 3.473s locally and 6.499s against that earlier Fly image; those are not MacBook comparison results. The live oversized-registration rejection was also checked on that earlier image.

The public default button runs one fixed cloud check. The owner comparison is inside Details and needs the private mini route for its mini trials. Both modes use checksum-pinned runtime assets and 4096-byte sent / 16384-byte received budgets; neither makes a bank request. Setup success never clears the payment gate.

## Remaining work

Obtain an authenticated response-shape result for one existing outgoing transfer under the owner's approval for the cloud verifier and exact disclosure. Establish status and JSON structure before changing provisional selectors. The public setup and public extension checks are not a completed P2P trade or payment-proof demo.

The next owner action is [the cloud response-only page](https://stellar-p2p-proof-vijay.fly.dev/response-check/). It displays the verifier and exact disclosure, requires explicit account-owner consent and consumes that consent after each extension execution. Its plugin exposes only **Check response only** and rejects payment-field mode even through an explicit exported-function call. This route does not make an authenticated request until the owner opens the extension, selects an existing transfer and explicitly requests the check. Read [setup](setup.md) before use.

After the bank response is independently verified, the payment-policy signer and escrow milestones in [the build plan](build-plan.md) remain. Do not release funds from browser callbacks, screenshots, field-presence summaries or setup results. Keep the Fly VM running for the intended public demo and review its lifetime after the submission; no shutdown schedule was created.

## Keeping the repo clean

Use synthetic fixtures. Keep credentials, bank identifiers, proof transcripts and runtime logs in private local storage. Review the staged content before every push; an ignore rule cannot protect a file already tracked in Git. Record new live checks with the actual host, date, result and limitations, without publishing private account details.

For an authenticated response check, do not dump the verifier log into tool output or chat. The approved request path contains a private transaction ID. Parse logs within the execution environment and expose only the allowlisted status, content category, JSON root type, field names and verification outcome. Never copy the raw request path or transcript into evidence files.
