# What works so far

This is the starting point for the hackathon build. Earlier experiments are recorded here without including bank data or raw proofs. See [the machine-readable summary](../evidence/prototype-status.json) and [current packaging checks](verification.md).

| Part                                        | Evidence                                                                                                                                               | Limit                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Public proof through the official extension | Completed on the Mac mini on 23 October 2026. The verifier accepted the `app.revolut.com` server identity and HTTP 200 response for `GET /robots.txt`. | No account login or payment data was used.                                                          |
| Ordinary-browser MPC setup on Windows       | User reported a pass in 10.7 seconds, 76.1 MB queued, 3.4 MB received and no pending upload.                                                           | This was setup only, outside the extension’s offscreen worker.                                      |
| Windows extension payment test              | Repeated `MPC_SETUP_TIMEOUT` at the extension’s 30-second limit. An earlier attempt reached a response but missed required field `0.amount`.           | No authenticated transfer proof was accepted on the active TLSNotary path.                          |
| Automated source tests                      | Synthetic tests cover request matching, explicit clicks, limited disclosure, route restrictions, pinned assets and sanitized errors.                   | They do not reproduce the real bank response. Run them again in this checkout.                      |
| Earlier Soroban signature experiment        | A local compatibility experiment exists in `archive/reclaim/`.                                                                                         | It uses a retired claim format and has no escrow or release rules. The repo fixtures are synthetic. |
| Payment-policy signer and escrow            | Designed in the architecture notes.                                                                                                                    | Not implemented or deployed. No release has occurred.                                               |

## The remaining feasibility gate

First reproduce the fixed public extension check in Windows Chrome. If it passes, run one separately approved response-shape check for an existing outgoing transfer. Establish HTTP status and JSON structure before changing selectors or requesting more fields.

The plugin currently expects array paths such as `0.amount` and `0.recipient.code`. Those are provisional. A missing field could mean a different shape, an authentication error or a different transaction type; it is not enough evidence to remove the array index.

An authenticated test passes only when the server verifies the intended completed outgoing transfer, including recipient, amount units, currency, stable ID, time and type. Until then the release gate stays `NOT_CLEARED`.

## Constraints to keep

- Use the pinned extension and verifier versions together.
- Keep the working 4 KiB / 16 KiB proof budgets. Larger budgets exhausted the pinned MPC stream limit in earlier tests.
- Keep setup deadlines and protocol protections in place while investigating failures.
- Public checks use GET. The pinned runtime’s method enum supports GET, POST, PUT and DELETE; HEAD is unsupported.
- Never treat a browser callback, screenshot, uploaded receipt or successful setup as authorization to release USDC.

The repo cleanup does not rerun the historical live proof. Current automated check results belong in the development handoff; live claims retain their original observation dates.
