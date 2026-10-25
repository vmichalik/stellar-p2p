# Pitch and demo

## Short pitch

I’m building Pactlane for people who want Stellar assets using the bank app they already have. A human supplier quotes the whole price and funds escrow. The buyer can see the terms before sending a Revolut payment; the supplier sets a price that can cover their costs and a margin.

The intended payment check discloses selected fields to an operator. The operator checks the payment and signs a claim that Stellar Smart Contracts can use to release the escrow once. This offers another route into Stellar assets with clear terms and a defined proof process. It does not guarantee a cheaper trade, and Stellar settlement remains public.

The app, escrow and policy have been checked locally with synthetic payment evidence. The actual browser and host also support exact two-party recovery, checked with mocked wallet and chain services. Accepted bank evidence and an authorized testnet trade remain unfinished.

## Message for a judge

Pactlane connects someone who wants Stellar assets with a human supplier willing to quote a price. Use Revolut to pay, with the tokens held in escrow and the whole price agreed upfront. The supplier can include a margin; the buyer reviews a selected-field payment check. I’ve built the local contract, policy and product flows, including recovery that requires both parties. Real payment proof is the next milestone. I’d value feedback on that trust model and the first small pilot.

## Demo sequence

1. Explain the buyer’s existing bank app and the supplier’s upfront quote. Ben’s 22 USDC for €20 is illustrative pricing, not a market rate or demonstrated profit.
2. Show Ben funding one whole offer, then Ana reserving it and confirming the payment lock before instructions. Keep the sample-data label visible.
3. Show the actual synthetic consent and payment-check screens. Explain the intended selected fields; no accepted bank proof is shown.
4. Present the dated compiled-WASM release and replay rejection as a separate local record with synthetic payment and tokens. Do not stage a fresh terminal run.
5. Return explicitly to the simulated product receipt.
6. Use a second held order for recovery: the seller approves the exact split, then the buyer signs the final transaction. Label the actual browser/host rehearsal as mocked wallet and chain.
7. Close on one proposed consented pilot through accepted bank evidence and an authorized testnet deployment.

The synthetic receipt, historical local-WASM result and mocked recovery are distinct evidence. None establishes a live bank-to-chain trade.

## Likely questions

**Why would a buyer use it?** To arrange a direct trade using an existing Revolut account and Stellar wallet, see the whole quote before paying, and use a defined payment check. The first users and pilot are proposed; demand and price advantage have not been demonstrated.

**Why would a supplier participate?** They choose the offer size and price, including a possible margin for supplying tokens and handling the trade. Their costs and the agreed price determine the outcome; the demo is not evidence of earnings.

**Who do I trust?** The intended flow relies on Revolut’s record, TLSNotary’s source authentication and the configured operator’s payment interpretation. The contract trusts that operator’s signature. Accepted bank-payment evidence is still missing.

**What is private?** The design aims to disclose selected payment fields rather than a full transaction history. The operator sees those fields, Revolut sees the payment, and Stellar settlement is public. The synthetic consent screen demonstrates the intended review, not a verified private bank integration.

**What if I pay and proof fails?** Tokens stay held. A later valid proof can release a timely payment, or both parties can agree to release, refund or split. There is no unilateral post-lock refund; an uncooperative counterparty can leave funds locked.

**What is actually verified?** Recorded component checks, a local compiled-WASM rehearsal and a two-browser recovery rehearsal with mocked wallet/chain services. No accepted authenticated payment, deployed escrow or live settlement is established by this candidate.
