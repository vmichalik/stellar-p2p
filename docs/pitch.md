# Pitch and demo

## Short pitch

I’m building Pactlane, a ZKP2P-style on-ramp for Stellar. You pay a seller in Revolut, prove the payment, and receive USDC from a Soroban escrow. I want it to work with the bank app you already use, without sending the seller your whole transaction history.

The escrow, policy signer and buyer/seller app are built. They work together locally with synthetic payment evidence and the compiled contract. The separate live browser and authenticated host are also implemented locally, including exact two-wallet recovery and receipts checked against mocked chain events. Real bank proof and a deployed testnet trade remain unfinished. MB WAY would be a useful second rail for Portugal once the first works reliably.

## Message for a judge

I’m building Pactlane: Revolut payment in, Stellar USDC out. The seller funds escrow, the buyer locks the trade before paying, and a signed payment check releases the USDC once. I’ve got the contract and policy working together locally, including replay protection and recovery if proof fails. I’m still closing the real payment-proof gate. I’d love your take on the trust model and whether this is a useful first on-ramp for Stellar.

## Demo sequence

1. Ben funds one whole 22 USDC offer for €20.
2. Ana reserves it, confirms the payment lock, then sees instructions.
3. Explain the intended Revolut transfer and selected-field approval. Label reconstructed or synthetic screens.
4. Show policy matching the order and signing the canonical claim.
5. Show the actual local compiled-WASM payout and replay rejection, labeled local/synthetic. Replace this with transaction links only after an authorized testnet run.
6. Use a separate held order for proof failure and two-wallet recovery.

The demo receipt is simulated. Separate live-browser rehearsals use real HTTP and fixture wallet signatures with mocked chain services; they do not establish network settlement. The compiled-WASM result is real contract execution with a synthetic token/payment. Neither is a bank proof or network transaction.

## Likely questions

**Who do I trust?** Revolut for its record, TLSNotary for the authenticated transcript, and the configured operator for payment interpretation/signing. The contract checks that operator’s signature.

**Why not a receipt?** A buyer-supplied PDF or screenshot does not authenticate the bank’s response or establish that this exact order was paid.

**What is private?** The intended verifier receives selected payment fields. Revolut sees the payment; Stellar settlement is public. We are not claiming private on-chain balances.

**What if I pay and proof fails?** Tokens stay held. Retry a timely payment’s verification, or both parties agree to release, refund or split. There is no unilateral post-lock refund. An uncooperative counterparty can leave funds locked.

**Why Revolut rather than MB WAY?** We have a narrower proof target for Revolut. A verified MB WAY send remains unestablished; MB NET virtual cards do not solve that proof by themselves.

**What is actually verified?** Component suites, an app-model → policy → compiled-WASM rehearsal, and a two-browser mutual-recovery rehearsal with mocked chain services pass. Public TLSNotary proof passed separately. No authenticated payment, deployed escrow or live settlement is established by this branch.
