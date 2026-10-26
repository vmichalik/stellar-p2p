# Explain Pactlane

## Thirty seconds

Pactlane lets people buy USDC on Stellar using the bank app they already have. A seller sets a price and funds escrow. The buyer pays through Revolut, verifies the transfer and receives USDC in their wallet. We connect authenticated bank-payment evidence with Stellar Smart Contracts, so both sides can follow the same trade from offer to receipt.

## A two-minute demo

Start with the user: “I have euros in Revolut. I want USDC in my Stellar wallet.”

Show the seller funding an offer. Switch to the buyer, show the exact quote and reserve it. Confirm the payment lock before showing the payment instructions. Review the transfer record, complete verification and show the receipt. Keep the Demo mode switch visible throughout this walkthrough.

Then open the mainnet receipt: €0.89 paid through Revolut, verified with TLSNotary, and 1 USDC delivered to the buyer. Show the Stellar transaction and the empty escrow balance. The separate testnet run covers replay rejection and two-party recovery. [Mainnet result](release/mainnet-result.md).

Close with the next product step: a small EUR corridor with repeat suppliers, measured for completion time, liquidity and repeat usage.

## Questions worth answering

**Why would someone use this?** They can arrange a direct trade using Revolut and their own Stellar wallet, with the price and recipient clear before payment.

**Why would someone supply USDC?** They set the offer size and price, including their margin. The buyer pays them directly.

**What does Stellar do?** It holds the tokens, records the order, checks release authorization and prevents the same payment from releasing twice within that escrow.

**Who checks the bank payment?** TLSNotary authenticates the bank response. Pactlane’s payment service checks the transfer against the order and signs the claim the contract accepts.

**What happens if verification fails?** The USDC stays held. A valid proof can complete the trade later, or both wallets can agree on a release, refund or split.

**What can judges inspect?** A completed Revolut-to-USDC mainnet trade, the working browser flow, testnet recovery, contract tests and policy code. [Status](status.md) links each result.

**What is the ambition?** A marketplace connecting the payment apps people already use to the Stellar assets and apps they want, with liquidity supplied by other people.
