# Pitch and demo

## Short pitch

I’m building a ZKP2P-style on-ramp for Stellar. You pay a seller in Revolut, prove the payment, and receive USDC from a Soroban escrow. The goal is to use the bank app you already have without sending your whole transaction history to the other person.

The prototype can prove a public Revolut response through TLSNotary. I’m working through the authenticated payment proof next, then the order-bound signer and testnet escrow. MB WAY would be a useful second rail for Portugal once that path is reliable.

## Message for a judge or mentor

I’m working on a Stellar version of ZKP2P, starting with Revolut. The idea is to prove a bank payment and use it to release USDC from escrow. I’ve got the public TLSNotary proof working; the payment proof is the current blocker. Would you focus the weekend on one complete on-ramp trade, or is there a more useful Stellar use case for that payment proof?

## Demo to build toward

1. Show a funded USDC offer and reserve it as the buyer.
2. Show the EUR payment instructions and the completed payment in Revolut.
3. Generate the proof with a clear disclosure prompt.
4. Show the verifier matching the payment to the order.
5. Release testnet USDC and open the transaction link.
6. Resubmit the same payment and show the replay rejection.

Use synthetic identities in screenshots and presentation assets. If the full flow is incomplete, show the public proof and describe the missing steps; do not narrate a payment or release that did not happen.

## Likely questions

**Who do I trust?** The bank for the payment record, TLSNotary’s protocol and runtime for the authenticated transcript, and our configured verifier operator for payment policy and claim signing.

**Why not use a receipt?** A PDF or screenshot supplied by the buyer is not enough to authorize escrow release. We want evidence authenticated against the bank’s server.

**What is private?** The plan reveals selected payment fields to the verifier. The bank still sees the payment. Stellar transfers remain public unless a separate privacy layer is added.

**Why not MB WAY first?** We haven’t established a reliable proof route for an MB WAY send. Revolut gives us a narrower first test.

**What happens if I pay and the proof fails?** That recovery policy is still open. It must be resolved before real funds are put in escrow.

**What is actually built?** Browser proof tooling, public diagnostics and a separate archived Soroban signature experiment. The live payment-policy and escrow flow remain to be built.
