# Pactlane submission draft

Prepared for the private hackathon submission. These are reusable answer blocks; the authenticated portal’s exact questions, limits and reviewer instructions remain unchecked. The recorded official deadline is **26 October 2026 at 12:00 Lisbon time**. See the [schedule](https://www.hackmeridian.com/schedule). Publication, reviewer access and submission remain pending.

## One sentence

Pactlane is a peer-to-peer on-ramp prototype for buying Stellar assets with Revolut from a human supplier at an upfront price.

## Why a buyer and supplier would use it

A buyer who already uses Revolut and a Stellar wallet wants a direct way to acquire assets, clear terms before paying and a defined way to check the payment. A human supplier chooses how many tokens to offer and a price that can cover their costs and a margin. Pactlane explores that exchange route with one EUR rail and one whole offer.

The intended proof discloses selected payment fields to the operator, rather than the buyer’s full transaction history. The operator still sees the disclosed fields, Revolut sees the transfer, and Stellar settlement remains public. A synthetic consent screen shows the intended review; accepted bank evidence remains unfinished.

The €20 / 22 USDC example is illustrative pricing. It is not a current market quote, guaranteed saving or demonstrated supplier profit. The proposed first users are counterparties who can reach each other for a small trade. No customer interviews, adoption, liquidity or pilot commitments are claimed.

## How the trade works

The supplier funds a fixed whole offer. The buyer reserves it and confirms the payment lock before receiving instructions. An accepted payment claim would let the escrow release once. If proof is unavailable after the lock, funds stay held; a later valid proof or an agreed two-party resolution can complete the trade.

The first part of the demo shows this intended journey with sample data. The live host currently blocks new payment locks because accepted payment evidence is unavailable.

## What we built

A buyer/supplier interface, escrow using Stellar Smart Contracts, an operator-run payment-policy service, durable replay protection and a canonical signed claim. The contract checks the configured policy signature, binds the order and deployment, consumes a stable payment identity and releases at most once.

The actual browser and host connect Freighter, authenticated sessions, coherent chain reads, transaction journaling and reconciled receipts. Recovery uses the seller’s exact smart-contract authorization followed by the buyer’s final transaction signature. Seller approval alone cannot submit the recovery. Amounts remain exact integer units.

## What has been verified

The recorded local rehearsal executed the compiled escrow WASM with the policy signer, synthetic payment evidence and a synthetic token. It checked the signature and rejected replay at both policy and contract boundaries. This is historical local execution, not a new testnet run.

Separate browser and HTTP checks exercised the actual host, recovery broker and authorization collector with fixture signatures and mocked wallets and chain services. The media labels the synthetic product journey, local-WASM record and mocked recovery separately. No accepted authenticated payment or live bank-to-chain trade is established.

## Why Stellar

Stellar Smart Contracts provide programmable escrow and atomic one-use release. Freighter supplies wallet approvals; the Stellar SDK handles transactions, authorization and XDR. TLSNotary is the intended source of authenticated bank-response evidence. A configured operator interprets disclosed payment fields and signs the claim checked by the contract.

Genesis / Stellar Composed is the proposed path, subject to organizer confirmation of eligibility and preparatory work. See the [FAQ](https://www.hackmeridian.com/faq). No track eligibility is claimed as settled.

## Trust and recovery

The contract trusts the configured payment-policy signer; it does not verify a raw bank transcript. The intended proof authenticates a source response, while the operator determines whether its payment fields satisfy the order.

There is no unilateral timeout refund after payment lock. A timely payment can be verified later, or both parties can authorize a release, refund or split. An uncooperative counterparty can leave funds held. Manual recovery requires complete payment-identity reconciliation before policy signing resumes.

## What remains unfinished

Authenticated bank payment evidence has not been accepted. Proof generation and payment normalization remain unfinished, so the live host continues to block new payment locks. The latest diagnostic history belongs in the proof handoff; it does not change that product gate.

An approved testnet deployment, authorized real-wallet trade, reachable delivery, reviewer access and submission remain outstanding. The revised 90-second silent video and seven-page PDF have passed media review; their hashes and scope are recorded in the [media handoff](release/submission-package.md). The six-file ZIP passed CRC and manifest-hash verification. No deployed contract, real payout, transaction link or customer traction is claimed.

## Progress and next pilot

Preparation preceded the event, and the repository preserves that history. Describe progress using the actual commits: app/policy/escrow integration, TLS handoff, authenticated browser/host services, durable transaction recovery and two-party authorization. Do not claim every component was created during the event.

The proposed next pilot is one consented EUR trade through accepted bank evidence and an authorized Stellar testnet deployment. Measure completion time, the failure stage, replay handling and both token balances. Use a separate order for mutual recovery. Expand only after the first complete trade is established.

## Materials to attach

The product presentation revision is `762598ebb4c1ab4b03b64e47e57b753bc02b086b`. Revised app captures preceded that commit and record `39834ef` plus working presentation changes. The media keeps the earlier local-WASM record, recorded component checks and historical mocked recovery screenshot distinct from new captures; the older `9eb7f02` package remains preserved.

Use the exact reviewed source candidate, revised silent video, separate optional dub notes, pitch deck and verified transaction links only if an authorized deployment actually exists. Confirm portal fields, media limits, eligibility and private-repository reviewer access before uploading. These answers have not been submitted or sent to reviewers.
