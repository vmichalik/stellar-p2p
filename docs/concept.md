# The idea

I want to get from euros in my bank app to USDC in my Stellar wallet without sending money to an exchange first.

The starting point is ZKP2P’s model: prove an off-chain payment, then use that proof to settle an on-chain trade. The Stellar version should feel simple: pick an offer, pay the seller in Revolut, prove the payment, receive USDC.

## Who it’s for

The first user is someone who already has Revolut and wants USDC on Stellar. The seller supplies the USDC and accepts EUR. A useful first pilot would be a small group trading with known limits; liquidity and reliable payment verification matter more than adding more rails.

## Why Stellar

The intended integration puts the USDC escrow and release rules in Soroban. The interesting part is bringing evidence from a normal payment app into that trade. Stellar is the settlement layer; the bank payment still happens outside the chain.

The escrow and policy now execute together locally against compiled Soroban WASM. A testnet deployment and real wallet transaction are still needed for the network demo.

## Why Revolut first

We found an individual-transfer response to target and built tooling around it. That gives us a narrow feasibility question: can the verifier authenticate a completed outgoing payment and bind it to the right order?

MB WAY is a useful follow-on for Portugal. We have not established a working proof route for an MB WAY send. MB NET virtual cards address a different payment flow and do not, by themselves, prove that one person paid another. The MVP should not depend on resolving both rails.

## Weekend scope

One seller, one buyer, one EUR payment rail and testnet USDC. The finished demo should show an accepted proof, one release, and rejection when the same payment is submitted again.

An order book, multiple banks, agent automation and private on-chain balances can wait. x402 and agent payments were early ideas; an agent could eventually fund its Stellar wallet through this flow, once the payment and settlement path works.

## Decisions still open

- Can an existing outgoing transfer be proved reliably on the owner’s current MacBook Pro?
- Which signed fields establish recipient, direction, completion and a stable payment ID?
- How do we bind the payment to a newly reserved order and reject older payments?
- Is the verifier-signer trust model useful enough for the first pilot?
- Can the live host reliably reconcile every payment identity across deployments and manual recoveries?

Recovery is decided: after the payment lock, proof failure holds funds. A later valid proof can release, or both parties authorize the same release/refund/split. There is no unilateral post-lock timeout refund. An uncooperative party can leave funds locked.
