# Product positioning

Pactlane is for someone who has euros in Revolut and wants USDC in a Stellar wallet. A supplier quotes the price and funds the tokens. The buyer pays the supplier directly. Escrow and payment verification connect the two sides.

## The promise

Use the payment account you already have. See the price before you pay. Receive assets in the wallet you choose.

The first corridor is EUR through Revolut to Stellar USDC. Suppliers can price their liquidity and costs into the offer. Buyers compare the exact euros paid and USDC received.

## How to explain the difference

Exchanges and existing on-ramps already serve this market. Pactlane offers a direct trade with a person supplying liquidity, supported by authenticated payment evidence and a Stellar escrow. Credit ZKP2P for the proof-based P2P model. Explain Pactlane’s Stellar integration and its payment-lock and recovery design.

Avoid generic claims about cheaper fees or guaranteed supplier earnings. The product already has a stronger, concrete story: the buyer knows the terms and the supplier sets the price. Compare quotes using the same amount, destination, location and time when measured data is available.

## Privacy direction

The goal is to disclose only what is needed to verify a trade. The current complete-record check shares the transfer response after consent; the verifier sees that record, Revolut sees its payment and Stellar settlement is public. Narrower disclosures are a product milestone, documented in the [data model](architecture/privacy-and-data.md).

## What to learn first

Ask buyers about their last purchase and why they needed Stellar USDC. Ask suppliers how they acquire liquidity, price risk and handle payments. Then observe small trades and measure where people hesitate or leave. Use repeat usage and completed trades to decide what to build next.
