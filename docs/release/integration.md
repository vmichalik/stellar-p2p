# Pactlane integration candidate

This branch integrates frozen component handoffs and the local rehearsal. It leaves main's dirty proof material and the other worktrees intact.

## Intake

| Component             | Source snapshot                                                                                   | Integrated commit                          |
| --------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Escrow/protocol       | `5be4b168102a53160a3d7423b98d3627f25e806a` + handoff `6196df363e4b711dc1a0cf3c2b7cab8aa0bf0a78`   | `7d12fe5` + `ae23f97`                      |
| Payment policy        | `52600e2afd68363369486b3d7e098c0e95d248c0` + handoff `dd7259c`                                    | `aaf2566` + `b4af19d`                      |
| Buyer/seller app      | `f4c6c42`                                                                                         | `b975419a805c0e5273be0b801c3f9db5c64630b2` |
| Release runtime       | App/policy/WASM bridge, durable wallet/RPC candidate, root scripts                                | `006ab023e4d44600d03f320f220457e5b5545f0e` |
| Cloud proof runtime   | `38eb912` public diagnostics + `f433423` plugin mitigation + `2c98f8e` deployment/uptime evidence | Local intake; 183 JS checks passed         |
| Video/deck/submission | Separate artifact owner                                                                           | Final source/assets not imported           |

The recorded integration-source checks show matching canonical encoder/policy/vector hashes and a byte-identical frozen WASM rebuild. Those results retain their source revision and were not rerun during intake. The coordinator’s new combined check passed 183 JavaScript tests with zero skips, eight Python preparation tests and 65 syntax checks; see [verification](../verification.md). Later formatting of component docs/test scripts does not alter the protocol or contract source. TLS history and source provenance are in [the proof handoff](../proof-handoff.md); local import does not redeploy its running service or deploy the combined app.

## Rehearsal results

Fixed whole offer, confirmed lock before instructions, failure retaining funds, late timely-payment proof, one signed release, contract/policy replay and duplicate UI settlement all pass locally. Native/WASM escrow suites include mutual settlement, authorization and conservation. Browser rehearsal passes the synthetic seller-to-buyer failure/retry/receipt path and persisted reload; component-owner evidence covers the two-wallet synthetic recovery path.

See [verification](../verification.md) for counts and [the recorded local run](../../evidence/release/local-wasm-rehearsal.json). This branch does not turn synthetic fixtures into live payment evidence.

## Gaps

- Sanitized proof source is imported, but authenticated response semantics remain unresolved; `NOT_CLEARED`. Bank tests remain paused pending owner resumption and normal per-attempt consent/disclosure review.
- Browser wallet/host transport, authenticated policy routes/readers/indexer and dual-wallet recovery collection remain software work.
- Approved token/signer/deployer/fee configuration and network execution remain unestablished.
- Static demo exists locally; no public app URL or separate-device reachability established.
- Final silent video/deck, portal limits/timezone, reviewer access and submission remain with owner/coordinator.

No new bank disclosure, account, funding, hosting, repository visibility, invitation or final-submission action is inferred from this integration.
