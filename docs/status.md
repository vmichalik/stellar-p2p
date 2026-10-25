# What works so far

Checked on the Mac mini on 25 October 2026. This is an integrated local candidate. It is not an authenticated payment-to-testnet success.

| Part                      | Evidence                                                                                                                                                      | Limit                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Buyer/seller app          | Whole-offer funding, reserve, confirmed payment lock, failure/retry, mutual recovery and receipts; 14 model/adapter tests. Browser flow rehearsed again here. | All browser wallets, payments and settlement are simulated.                                                                |
| Soroban escrow            | 29 native and the same 29 compiled-WASM tests passed in this checkout. Reviewed optimized artifact is tracked.                                                | Local host and synthetic token; no deployed contract.                                                                      |
| Canonical protocol        | 11 SDK compatibility tests and policy snapshot hash check passed.                                                                                             | Encoding/signature compatibility does not prove bank semantics.                                                            |
| Payment policy            | 55 tests passed, including replay/restart/concurrency and manual-recovery reconciliation.                                                                     | Live normalizer deliberately rejects with `TLSN_PAYMENT_SCHEMA_UNVERIFIED`.                                                |
| Cross-component rehearsal | Actual app model → durable policy → canonical Ed25519 claim → compiled escrow WASM → one payout → replay rejection.                                           | Synthetic payment and token, local execution, no network transaction.                                                      |
| Wallet/RPC candidate      | 11 tests passed using the actual SDK, mocked wallet/RPC and real disk journal.                                                                                | Node service candidate; browser transport, deployed configuration and dual-wallet recovery collection are not implemented. |
| Static demo package       | Explicit nine-file allowlist, hashes, synthetic manifest and no-external-connection headers.                                                                  | Local build only; no hosted app URL.                                                                                       |

## Proof observations

- **23 October, 17:53:56 UTC:** historical Mac-mini public `GET /robots.txt` proof accepted for `app.revolut.com`, HTTP 200. No login or payment data.
- **25 October, 10:46:50 UTC:** the proof workstream recorded public-proof acceptance from the MacBook Pro. This integration lane did not repeat it.
- **25 October, 12:34:28 UTC:** the proof workstream reported server acceptance of the cloud public proof. At that checkpoint it was preparing the owner-approved response-only check. Its sanitized source snapshot through `2c98f8e` is now integrated locally; this lane has not repeated a live proof.
- Older Windows setup and timeout results remain in [historical evidence](../evidence/prototype-status.json). The current owner browser device is the MacBook Pro.

None establishes an authenticated transfer. The live payment gate remains **`NOT_CLEARED`**. A screenshot, callback, setup result, public proof or uploaded receipt cannot authorize release.

## Remaining software

1. Establish the real response schema and source/account/recipient identities, exact units, direction, state and completion time with the proof owner. Then implement the live normalizer against accepted server evidence.
2. Connect the browser to authenticated host services: wallet signing bridge, authoritative order/config reader, private recipient/salt reader, policy status/claim routes and complete reconciliation. The demo currently imports only its synthetic adapter.
3. Collect both wallets’ authorization for the same recovery invocation. The contract and demo support it; the live RPC candidate refuses a one-wallet shortcut.
4. Rehearse the complete path against a configured, authorized testnet deployment and reconcile actual transaction/balance evidence.

## External prerequisites

The official testnet RPC reported protocol 29 in a read-only check at 13:03 UTC on 25 October. That matches the artifact’s required protocol; it does not establish a deployment. Approved token/decimals, policy public key, existing deployer, fee limit and transaction authorization remain unconfigured. Public app hosting, private-repo reviewer access and final submission are also unestablished.

Detailed provenance is in [verification](verification.md) and [the release handoff](release/HANDOFF.md). No existing proof service was restarted or changed by this integration lane.

## Domain and UX update

`https://pactlane.io` is the prepared canonical app origin. Worker redirects, metadata/social card and exact static packaging pass local checks. Root owns publication. `https://proof.pactlane.io` remains pending DNS/certificate verification; operational instructions retain the existing Fly hostname. No origin switch or bank request was performed here. See [domain handoff](release/DOMAIN-HANDOFF.md).

The TLS source handoff supersedes the earlier disconnect diagnosis: it records trial-enforced Fly shutdown after disclosure, then 391.5 seconds of observed uptime after the owner upgraded PAYG. That finite source observation is not a new live-readiness test. Authenticated payment acceptance is still unestablished.

Final app polish is pending. Two coordinator-identified behavior gaps must be fixed before publication: verification of an unreported timely payment while recovery is proposed, and the expired pre-lock Reserved refund action. The current built bundle is an intermediate review artifact until the app snapshot is integrated.
