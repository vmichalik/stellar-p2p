# What works so far

This is the starting point for the hackathon build. Earlier experiments are recorded here without including bank data or raw proofs. See [the machine-readable summary](../evidence/prototype-status.json) and [current packaging checks](verification.md).

| Part                                        | Evidence                                                                                                                                                                         | Limit                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Public proof through the official extension | Completed on the Mac mini on 23 October 2026. The verifier accepted the `app.revolut.com` server identity and HTTP 200 response for `GET /robots.txt`.                           | No account login or payment data was used.                                                                   |
| Ordinary-browser MPC setup on Windows       | User reported a pass in 10.7 seconds, 76.1 MB queued, 3.4 MB received and no pending upload.                                                                                     | This was setup only, outside the extension’s offscreen worker.                                               |
| Windows extension payment test              | Repeated `MPC_SETUP_TIMEOUT` at the extension’s 30-second limit. An earlier attempt reached a response but missed required field `0.amount`.                                     | No authenticated transfer proof was accepted on the active TLSNotary path.                                   |
| Public extension proof on MacBook Pro       | On 25 October, owner reported HTTP 200 and completed public proof; Mac mini verifier acceptance was checked at 10:46:50 UTC.                                                     | Public fixture only; authenticated payment remains unresolved.                                               |
| MacBook setup deadline diagnosis            | One approved response-shape attempt timed out during setup. A bank-free setup then passed in 36.2s, with 13.0 MB still queued at 30s.                                            | No bank response was obtained by the failed authenticated attempt.                                           |
| Public cloud diagnostic                     | [Fly Paris setup page](https://stellar-p2p-proof-vijay.fly.dev/benchmark/) is deployed on one 2-shared-vCPU / 4-GiB VM. HTTPS health/version and browser isolation were checked. | Public MPC setup only; no payment proof, signing or release.                                                 |
| Same-MacBook host comparison                | Three passes per host: mini median 17.9s; Fly median 17.4s. All six met 30s.                                                                                                     | Owner-reported browser results; small sample establishes no meaningful speed advantage.                      |
| Public extension proof against Fly          | MacBook reported HTTP 200; Fly independently verified server identity and reveal ranges, then sent `session_completed` at 12:34:28 UTC on 25 October.                            | Public fixture only, on image `9bb965…`; no authenticated bank request or payment proof.                     |
| Authenticated cloud response check          | Owner saw and approved disclosure preview. Fly reached TLS completion, then lost the control connection before receiving disclosure configuration.                               | No verified HTTP status, JSON shape or payment fields. Client runtime also failed; cause remains unresolved. |
| Released parser integration                 | Five synthetic cases execute the checksum-pinned shipped WASM, covering framing, gzip rejection and actual response-shape handlers.                                              | Closes the earlier mocked-parser coverage gap; does not reproduce the failure after approval.                |
| Automated source tests                      | Synthetic tests cover request matching, explicit clicks, limited disclosure, route restrictions, pinned assets and sanitized errors.                                             | They do not reproduce the real bank response. Run them again in this checkout.                               |
| Earlier Soroban signature experiment        | A local compatibility experiment exists in `archive/reclaim/`.                                                                                                                   | It uses a retired claim format and has no escrow or release rules. The repo fixtures are synthetic.          |
| Payment-policy signer and escrow            | Designed in the architecture notes.                                                                                                                                              | Not implemented or deployed. No release has occurred.                                                        |

## The remaining feasibility gate

The MacBook public extension proofs against the mini and Fly, and the two-host setup comparison, have passed. The subsequent owner-approved cloud response check failed after response parsing and disclosure approval. The verifier did not receive disclosure configuration; existing client logs also show a WebSocket failure and QuickJS runtime errors. Their causal relationship is unresolved. Read the sanitized timeline in [the handoff](handoff.md#failed-cloud-response-check-25-october-2026).

Infrastructure is frozen while this later failure is isolated. A longer setup deadline and additional upload benchmarks address a stage this attempt already passed. Establish HTTP status and JSON structure locally before changing selectors or requesting more fields; the prior Network entry is unavailable. Another authenticated proof is not the next diagnostic step.

The plugin currently expects array paths such as `0.amount` and `0.recipient.code`. Those are provisional. A missing field could mean a different shape, an authentication error or a different transaction type; it is not enough evidence to remove the array index.

The exact QuickJS callback-ID overflow was reproduced with shipped assets. A tested local plugin mitigation limits repeated header serialization and preserves the disclosure prompt; it is not deployed. The extension runtime limit, separate SDK disposal error and original connection failure are not claimed fixed. Final local checks pass 93 tests with zero skips; these include actual parser and plugin-host coverage but use synthetic proof results.

An authenticated test passes only when the server verifies the intended completed outgoing transfer, including recipient, amount units, currency, stable ID, time and type. Until then the release gate stays `NOT_CLEARED`.

## Constraints to keep

- Use the pinned extension and verifier versions together.
- Keep the working 4 KiB / 16 KiB proof budgets. Larger budgets exhausted the pinned MPC stream limit in earlier tests.
- Keep cryptographic checks and protocol protections in place. The owner explicitly requested a bounded local diagnostic extension with a 60-second setup watchdog; the official build remains at 30 seconds. The verifier's other deadlines remain unchanged.
- Public checks use GET. The pinned runtime’s method enum supports GET, POST, PUT and DELETE; HEAD is unsupported.
- Never treat a browser callback, screenshot, uploaded receipt or successful setup as authorization to release USDC.

The repo cleanup does not rerun the historical live proof. Current automated check results belong in the development handoff; live claims retain their original observation dates.
