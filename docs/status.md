# What works so far

The current local candidate combines the app/policy/escrow source, TLS through `2c98f8e`, and the live-service continuation. The complete local suite passed 232 JavaScript tests with zero skips, eight Python preparation tests and 77 syntax checks including generated demo copies. Earlier native/WASM escrow and browser rehearsal results retain their source provenance and were not rerun during this continuation. This is not an authenticated payment-to-testnet success.

| Part                        | Evidence                                                                                                                                                                                                          | Limit                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Buyer/seller app            | Whole-offer funding, reserve, confirmed payment lock, failure/retry, mutual recovery and receipts; 14 model/adapter tests. Browser flow rehearsed in the integration source checkout; not repeated during intake. | All browser wallets, payments and settlement are simulated.                                                     |
| Soroban escrow              | Historical integration evidence: 29 native and the same 29 compiled-WASM tests passed in the source checkout. Reviewed optimized artifact is tracked.                                                             | Local host and synthetic token; no deployed contract.                                                           |
| Canonical protocol          | 11 SDK compatibility tests and policy snapshot hash check passed.                                                                                                                                                 | Encoding/signature compatibility does not prove bank semantics.                                                 |
| Payment policy              | 55 tests passed, including replay/restart/concurrency, atomic chain checkpoints and recovery reconciliation.                                                                                                      | Live normalizer deliberately rejects with `TLSN_PAYMENT_SCHEMA_UNVERIFIED`.                                     |
| Cross-component rehearsal   | Historical source-checkout rehearsal: app model → durable policy → canonical Ed25519 claim → compiled escrow WASM → one payout → replay rejection.                                                                | Synthetic payment and token, local execution, no network transaction.                                           |
| Wallet/RPC and host modules | Actual SDK signatures/XDR, durable journals, HTTP authentication, consistent chain reads, event reconciliation and mutual recovery tested locally.                                                                | Host composition, private offer/policy ports and browser/counterparty wiring remain; no deployed configuration. |
| Static demo package         | Source-checkout build: seven-file allowlist, hashes, synthetic manifest and no-external-connection headers.                                                                                                       | Local build only; no hosted app URL.                                                                            |

## Live service continuation

The Node recovery collector, authenticated HTTP bridge, consistent chain reader and atomic event reconciliation are implemented locally. Their APIs, tests and remaining browser wiring are recorded in [the continuation](release/live-services.md). The local checks do not establish a deployed live app.

## Proof observations

- **23 October, 17:53:56 UTC:** historical Mac-mini public `GET /robots.txt` proof accepted for `app.revolut.com`, HTTP 200. No login or payment data.
- **25 October, 10:46:50 UTC:** the proof workstream recorded Mac mini verifier acceptance of the MacBook Pro public extension proof. This integration lane did not repeat it.
- **25 October, 12:34:28 UTC:** Fly accepted the MacBook public proof on image `9bb965…`. The source and sanitized evidence are now imported; this acceptance remains public-fixture proof, not payment evidence.
- **25 October, 12:54:26 UTC:** the owner-approved response-only attempt lost its control connection after disclosure approval. Fly platform evidence identifies a trial-enforced VM shutdown at that instant; no authenticated HTTP metadata, JSON schema or payment fields were accepted.
- **25 October, 13:31 UTC:** owner-approved plugin mitigation was deployed from `f433423` as image `eb0e1d…`. Served-code, consent and health checks passed with no authenticated retry.
- **25 October, 13:45:08 UTC:** after the owner reported a PAYG upgrade and the same VM was started at 13:38:36, a bank-free check observed **391.5 seconds** of uninterrupted uptime and HTTP 200 health. The former five-minute cutoff did not recur during that finite observation; indefinite availability is not established.
- Older Windows setup and timeout results remain in [historical evidence](../evidence/prototype-status.json). The current owner browser device is the MacBook Pro.

None establishes an authenticated transfer. The live payment gate remains **`NOT_CLEARED`**, and **bank tests remain paused pending the owner’s decision to resume** and normal per-attempt consent/disclosure review. A screenshot, callback, setup result, public proof or uploaded receipt cannot authorize release.

The shipped QuickJS callback-ID overflow was independently reproduced. The deployed plugin retains the newest transfer and reduces repeated captured-header serialization while preserving explicit disclosure approval. It reduces callback allocation; it does not fix the runtime’s finite callback-ID space or separate disposal errors. The observed server disconnect is explained by the Fly shutdown, not established as a QuickJS consequence. Read the complete chronology in [the proof handoff](proof-handoff.md) and historical checks in [proof verification](proof-verification.md).

## Remaining software

1. After the owner resumes bank tests, establish the real response schema and source/account/recipient identities, exact units, direction, state and completion time. Then implement the live normalizer against accepted server evidence. Browser/host work below can continue independently while the pause remains.
2. Compose the implemented host bridge, chain reader and event reconciler with persistent stores and private offer/policy ports, then connect the asynchronous browser adapter. The demo currently imports only its synthetic adapter.
3. Connect the implemented buyer-envelope/seller-Soroban recovery collector to both browser wallets. The HTTP bridge does not yet route the counterparty approval.
4. Rehearse the complete path against a configured, authorized testnet deployment and reconcile actual transaction/balance evidence.

## External prerequisites

The official testnet RPC reported protocol 29 in a read-only check at 13:03 UTC on 25 October. That matches the artifact’s required protocol; it does not establish a deployment. Approved token/decimals, policy public key, existing deployer, fee limit and transaction authorization remain unconfigured. Public app hosting, private-repo reviewer access and final submission are also unestablished.

Detailed provenance is in [verification](verification.md), [the release handoff](release/HANDOFF.md) and [the proof handoff](proof-handoff.md). Local source intake has not deployed the combined app or restarted or changed an existing proof service. Historical proof-workstream deployment and restart actions retain their own provenance above.
