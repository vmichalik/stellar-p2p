# Pactlane

I'm building a way for two people to exchange a Revolut payment for USDC on Stellar. The seller puts USDC into escrow, the buyer pays in Revolut, and an authenticated payment check authorizes the release.

I want to test whether a funded direct trade can complete without the seller checking each buyer's receipt and manually approving the release.

## What someone would use the USDC for

Someone might need USDC to use a Stellar app such as [Blend](https://docs.blend.capital/tech-docs/integrations), whose lending pools accept it, or to pay someone who already uses a Stellar wallet.

Cash-out is another example: a recipient can turn Stellar USDC into local cash through a compatible [MoneyGram wallet](https://developer.moneygram.com/moneygram-developer/docs/integrate-moneygram-ramps), subject to its location and identity requirements. We'd still need to compare the whole journey with a normal money transfer, including the recipient's costs. Pactlane doesn't currently provide that remittance service, and MoneyGram also supports Solana.

Someone who just wants to hold dollars probably doesn't care which chain they're on. Someone who wants euros onchain may prefer [EURC, which is also issued on Stellar](https://www.circle.com/eurc). We need a reason for the dollar conversion as well as the network choice.

## Why use this instead of an exchange?

For someone with a working exchange account and a good route to Stellar, there may be no reason to switch. [Kraken supports USDC deposits and withdrawals on Stellar](https://support.kraken.com/articles/360000678446-cryptocurrencies-available-on-kraken). Its [EUR funding options](https://support.kraken.com/articles/360000381846-cash-deposit-options-fees-minimums-and-processing-times-) include free SEPA deposits with no listed withdrawal hold. Trading and withdrawal costs still matter, but we can't claim that using an exchange always means expensive deposits or days of locked funds.

[Ramp's EU/EEA asset list](https://support.rampnetwork.com/en/articles/432-what-cryptoassets-does-ramp-network-support) also includes buying and selling USDC on Stellar, and it [supports bank transfers where available](https://support.rampnetwork.com/en/articles/12630-what-payment-methods-can-i-use-to-buy-crypto). Direct delivery to a wallet is already available. Avoiding exchange custody is a preference some people have, but Pactlane still requires trust in a payment verifier and an escrow contract.

Pactlane could make sense for someone who already wants a direct trade: they prefer paying through their existing payment app or can get better terms from a local seller. I haven't validated that audience. EUR and Revolut are where we can test the technology first; they aren't evidence of an underserved market.

The seller needs a reason too. Someone who receives USDC and needs euros could supply the other side. They need enough compensation to keep liquidity available and take on the risk of the bank payment. A proof of a completed payment doesn't make that payment irreversible. We haven't shown that a seller can offer competitive terms after those costs.

## What Pactlane would improve in a direct trade

Once two people choose to trade, the difficult part is deciding when to release the crypto. The buyer has sent money and wants their USDC. The seller needs to know that the right payment arrived. [OKX's dispute guidance](https://www.okx.com/en-us/help/how-do-i-raise-a-dispute-when-using-p2p-trading) describes the messages, screenshots and support cases that can follow a payment without a release. It shows that this problem exists, not how often it happens.

I'm borrowing [ZKP2P's approach](https://github.com/zkp2p/): authenticate payment data and use it to settle the trade. In Pactlane, the seller funds the agreed offer before the buyer pays. Payment instructions appear after the escrow lock confirms. The verifier checks the payment against the order and signs an authorization that the Soroban contract checks before releasing USDC.

That could remove the need for the seller to interpret a screenshot and manually approve each normal trade. It also depends on proof generation working. If verification fails after payment, funds stay held until a valid proof arrives or both people approve the same recovery. Either person can leave the trade unresolved. The extension and this failure path are substantial costs for a user.

I wouldn't lead with lower fees or privacy. We haven't measured cheaper quotes. We intend to disclose only the payment fields needed for verification, but Revolut still knows the payment, the verifier receives selected information, and Stellar settlement is public.

## What I want to prove next

I'd start with people already using a Stellar app who sometimes buy USDC from another person. Ask what they last needed it for and how they got it. Ask sellers what makes supplying USDC worthwhile. Then compare repeated wallet top-ups with their existing route: euros paid, usable USDC received, time spent and what happens when something goes wrong.

The weekend build stays narrow: one buyer, one seller, EUR through Revolut, and a fixed USDC offer. The [public app](https://pactlane.io) currently simulates that flow. The payment policy and compiled Soroban escrow have executed together locally, including a release and replay rejection. An accepted authenticated bank payment and a confirmed testnet trade are still outstanding.

Revolut is first because we have a specific transfer response to test. More rails can wait until this route works and someone chooses it.
