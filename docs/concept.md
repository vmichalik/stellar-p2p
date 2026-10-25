# Pactlane

I already have a bank account. If I need USDC in my wallet, I don't want another exchange account or another company holding a copy of my passport.

I'm building Pactlane so two people can make that exchange directly. One person has USDC and wants euros. The other pays them through Revolut and receives USDC in their Stellar wallet. I'd rather the person supplying the USDC earned the margin than hand it to a big exchange.

## What someone would use the USDC for

The buyer needs a reason to want USDC on Stellar. They might be funding an app such as [Blend](https://docs.blend.capital/tech-docs/integrations), whose lending pools accept it, or paying someone who already uses that asset and network.

Someone receiving USDC can also turn it into cash through a compatible [MoneyGram wallet](https://developer.moneygram.com/moneygram-developer/docs/integrate-moneygram-ramps), subject to its location and identity requirements. That could be part of a remittance route, although Pactlane doesn't provide that service and MoneyGram also supports Solana.

Someone who just wants to hold dollars probably doesn't care which chain they're on. Someone who wants euros onchain may prefer [EURC, which is also issued on Stellar](https://www.circle.com/eurc). Getting euros onchain doesn't itself justify converting them to dollars.

## Why use this instead of an exchange?

If someone already uses Kraken and is happy with it, they may have no reason to switch. [Kraken supports Stellar USDC](https://support.kraken.com/articles/360000678446-cryptocurrencies-available-on-kraken), with [free EUR SEPA deposit options](https://support.kraken.com/articles/360000381846-cash-deposit-options-fees-minimums-and-processing-times-). [Ramp also supports buying Stellar USDC](https://support.rampnetwork.com/en/articles/432-what-cryptoassets-does-ramp-network-support) directly into a wallet.

I want an option for someone who would prefer to use their existing payment account and trade with another person. Avoiding another institution's onboarding and identity collection is a reason to choose that route, even when the institution offers a good product.

[Exchange availability](https://support.kraken.com/articles/where-is-kraken-licensed-or-regulated) and [payment-app availability](https://help.revolut.com/en-PT/help/profile-and-plan/profile-plan/verifying-identity/what-countries-are-supported/) also differ. Someone can have access to one without the other. That is worth investigating country by country; it doesn't establish that Pactlane can serve them. The first build still requires Revolut.

## Less identity data to hand over

Already having completed KYC with a bank doesn't make me indifferent to doing it again elsewhere. Each additional company gets another set of sensitive documents. [Coinbase's May 2025 breach](https://www.coinbase.com/blog/protecting-our-customers-standing-up-to-extortionists) included government-ID images and customer account information.

The aim is to verify the payment using the facts needed for that trade, without Pactlane collecting another passport or a full bank statement. Revolut still knows who paid whom, the counterparty sees payment information, and Stellar transactions are public.

We still need to establish what identity checks a production service would require. The proof-service code also writes disclosed transcript data to server logs. That needs changing before a live privacy claim.

## Where the money goes

I like the idea that someone can earn money by making their USDC available to another person. They put up the funds and take the payment risk. The intended model lets them earn a margin in the price they offer.

Bank, network and verification costs still need paying, and Pactlane's pricing isn't decided. Sellers could also be businesses.

I also want to see whether we can beat card-on-ramp prices. [Ramp lists processing rates up to 3.9% for EUR card purchases and 1.4% for manual bank transfers](https://support.rampnetwork.com/en/articles/12634-fees-and-exchange-rates-when-buying-crypto). [Kraken Pro's base stablecoin trading fee is 0.20%](https://www.kraken.com/features/fee-schedule). Those are different services and neither figure is an all-in wallet quote. We need to compare euros paid with usable USDC received, including the seller's margin and every remaining charge.

## What Pactlane would improve in a direct trade

Once two people choose to trade, the difficult part is deciding when to release the crypto. The buyer has sent money and wants their USDC. The seller needs to know the right payment arrived. [OKX's dispute guidance](https://www.okx.com/en-us/help/how-do-i-raise-a-dispute-when-using-p2p-trading) describes the messages, screenshots and support cases that can follow a payment without a release.

I'm borrowing [ZKP2P's approach](https://github.com/zkp2p/): authenticate payment data and use it to settle the trade. The seller funds the offer before the buyer pays. Payment instructions appear after the escrow lock confirms. Pactlane's verifier would check the payment against the order and sign an authorization for the Soroban contract to release USDC.

The seller shouldn't need to inspect a screenshot and approve every normal trade. But payment evidence doesn't make a bank transfer irreversible. If verification fails after payment, USDC stays held until valid proof arrives or both people approve recovery. An uncooperative counterparty can leave the trade unresolved.

## What I want to prove next

I'd start with people who need USDC on Stellar and dislike opening another exchange account or already buy from other people. Find out what they actually used last time, whether identity collection affected that choice, and what price they'd accept. Ask sellers what they'd need to earn to supply USDC repeatedly. Then test whether the privacy benefit and direct trade are worth installing an extension and dealing with proof generation.

The weekend build stays narrow: one buyer, one seller, EUR through Revolut, and a fixed USDC offer. The [public app](https://pactlane.io) currently simulates that flow. The payment policy and compiled Soroban escrow have executed together locally, including a release and replay rejection. An accepted authenticated bank payment and a confirmed testnet trade are still outstanding.
