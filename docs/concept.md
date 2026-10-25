# From your bank app to your Stellar wallet

Pactlane starts with a familiar situation: you have euros in Revolut and want USDC in a Stellar wallet. Another person has USDC and is willing to sell it. Pactlane gives those two people a clear way to trade.

The buyer sees the complete quote before committing. The seller supplies the tokens upfront and chooses the price. Escrow holds the USDC while the buyer makes the bank payment. Payment verification connects that off-chain payment to the on-chain release.

## Start with a specific user

The first audience is people who already use Revolut and have a reason to hold USDC on Stellar: funding an app, paying a recipient or keeping assets in their own wallet. A focused EUR corridor makes it possible to learn what matters to buyers and liquidity suppliers before adding more payment methods.

For buyers, the question is whether the direct trade is clear and convenient enough to choose. For sellers, it is whether the price, completion time and payment risk make supplying liquidity worthwhile. The first pilot should measure both sides.

## What makes Pactlane different

Pactlane brings the payment-proof model to Stellar. The product connects familiar bank payments, wallet-controlled assets and an escrow with explicit rules for payment timing and recovery. Its contribution is the complete trade design: funded offers, a confirmed payment lock, source-authenticated evidence, one-use settlement and recovery requiring both parties.

The inspiration is [ZKP2P](https://github.com/zkp2p). Stellar Smart Contracts and Freighter provide the settlement and wallet pieces. TLSNotary provides the source-authentication layer.

## Where it can go

Build a reliable first corridor, then grow liquidity and add payment apps with verifiable transfer records. Narrower disclosures can reduce how much a verifier sees. Better wallet onboarding can make the flow easier for people arriving on Stellar for the first time.

The first pilot is ten small, consented trades with a few repeat suppliers. Measure time to find an offer, completion rate, verification time, recovery frequency and whether buyers and sellers return. Use those results to choose the next corridor and product changes.
