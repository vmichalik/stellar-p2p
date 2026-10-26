# Mainnet trade runbook

Target: the owner-approved **1 USDC for EUR 0.89** trade. The first supplied wallet is the seller and the second is the buyer. Their addresses and private configuration stay in the owner-input file. The price is the agreed test quote.

The first mainnet trade completed on 26 October 2026. [Result and transactions](mainnet-result.md). This runbook records the sequence used for that trade. A further trade needs its own approved terms, funded order and matching payment.

## Prepare the operator

1. Confirm the deployment account, exact Circle USDC asset, policy signer, RPC and fee cap with the owner. Recheck both wallets' trustlines and capacity before signing.
2. Use durable evidence/replay/journal storage and owner-reviewed wallet-to-bank bindings. Keep replay history across deployments and signer changes.
3. Configure the live policy port with the accepted-record store and confirmed chain reader. Attach the authenticated same-origin API to the public website.
4. Review the exact escrow deployment, initialized configuration and optimized WASM hash before funding. Expected artifact: `8940569853b21a957fc5a81402666e95ed75f054ce2223926231ffc2c0c506dd`.

[Operator inputs](mainnet-support.md), [host composition](live-services.md), [wallet readiness](wallet-readiness.md).

## Run one trade

| Step                 | Confirmation                                                                        |
| -------------------- | ----------------------------------------------------------------------------------- |
| Seller funds         | Exact 1 USDC deposit confirmed in the intended escrow.                              |
| Buyer reserves       | Reservation bound to the receiving wallet.                                          |
| Buyer locks payment  | Confirmed lock, exact EUR 0.89 instructions and verified recipient.                 |
| Buyer pays           | New payment made after that lock.                                                   |
| Buyer proves payment | Owner-approved disclosure accepted by the verifier and matched by the order policy. |
| Buyer releases       | Reviewed wallet transaction confirmed, then token events and balances reconciled.   |

The historical transfer predates this order and cannot pay for it. Do not send fiat before the confirmed lock. An unknown transaction outcome must be reconciled before another submission. After payment lock, a refund or split needs both parties' approval.

## Record the result

Keep deployment, funding, reservation, lock and release hashes for the same order; the exact network/asset; normalized policy acceptance; and buyer/seller/escrow balance changes. Never publish bank identifiers, raw responses, cookies or signing keys.

Call the canonical policy's `reconcileRelease` after confirming both the released order and the on-chain used-payment marker. This records settlement in durable replay storage. Order 0 completed this check; its release gate is `CLEARED`. Current public deployment and source are recorded in [the handoff](../handoff.md).

## Existing receipts

- [Completed mainnet trade](../../evidence/release/mainnet-trade-2026-10-26.json): EUR 0.89 / 1 Circle USDC, settled on 26 October 2026 at 09:52:33 UTC.
- [Mainnet read-only preparation](../../evidence/release/mainnet-preparation.json): protocol and asset decimals checked on 25 October 2026.
- [Complete-record deployment](../../evidence/release/complete-record-deployment.json): unchanged pinned verifier and private callback.
- [Accepted record](../../evidence/release/complete-record-accepted.json): 23:08:23.290 UTC on 25 October 2026, independently checked at 23:09:06.901 UTC.
- [Testnet rehearsal](../../evidence/release/testnet-rehearsal-2026-10-25.json): PLTEST release, replay rejection and mutual recovery.
