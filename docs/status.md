# Build and verification

Updated on the Mac mini, 26 October 2026. This page is the current record; dated artifacts retain the scope of their original runs.

| Part                | Observed result                                                                                                   | Evidence                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Website             | Published at pactlane.io, with separate demo and live modes, mobile navigation and funded-offer filtering.        | [Website receipt](../evidence/release/judge-review-publication.json)  |
| Bank record         | Authenticated completed Revolut transfer accepted by the verifier at 23:08:23 UTC.                                | [Acceptance](../evidence/release/complete-record-accepted.json)       |
| Mainnet trade       | EUR 0.89 paid through Revolut, verified and settled as 1 Circle USDC to the buyer on 26 October at 09:52:33 UTC.  | [Mainnet receipt](release/mainnet-result.md)                          |
| Stellar escrow      | Mainnet funding and release confirmed; separate PLTEST testnet replay rejection and mutual recovery passed.       | [Mainnet evidence](../evidence/release/mainnet-trade-2026-10-26.json) |
| Product flow        | Seller funding through buyer receipt, including failure and recovery states.                                      | [Browser checks](../evidence/release/judge-review-checks.json)        |
| Payment policy      | Exact amounts, order/time binding, durable replay protection and canonical signatures are implemented and tested. | [Policy](../policy/README.md)                                         |
| Live browser / host | Wallet sessions, transaction journaling, confirmed reads and two-party recovery are implemented.                  | [Integration](../integration/README.md)                               |

## Mainnet settlement

The **1 USDC for EUR 0.89** trade is complete. Order 0 is `Released`; the buyer gained exactly 1 USDC, escrow holds zero, and the payment-used marker is set. Canonical policy reconciliation marked the durable record settled. The release gate is **CLEARED for this trade**. [Deployment receipt](../evidence/release/mainnet-operator-deployment.json), [release transaction](https://stellar.expert/explorer/public/tx/ec4220af4056b185d242977385484066789824a2a274f57b3439e1e4dd1b9864).

The historical bank transfer anchored the owner-reviewed identity binding. It was excluded from payment matching; the new order used its own EUR 0.89 transfer after the confirmed payment lock. [Operator runbook](release/mainnet-test.md).

## Current review

The current application and publication work is on `codex/pactlane-mainnet-live`. Seller-created private drafts, wallet-switch guidance and public discovery files are covered by the latest focused checks. [Handoff](handoff.md) records the final commit, checks and publication receipt. [Verification](verification.md) is the short evidence index.
