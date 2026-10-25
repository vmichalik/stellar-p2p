# Pactlane submission draft

Prepared for the private hackathon submission. These are reusable answer blocks, not a claim that the portal's exact questions or media limits have been checked. Review materials are due **26 October 2026 at 12:00 Lisbon time**, per the [official schedule](https://www.hackmeridian.com/schedule). Submission, reviewer access and publication are still pending.

## One sentence

Pactlane is a peer-to-peer Stellar on-ramp prototype: a buyer pays a seller in Revolut, and a verified payment claim can release the seller's escrowed tokens once.

## Problem and first user

Someone who already uses Revolut should be able to buy Stellar assets from a willing counterparty without either person handing over control first. A screenshot is weak evidence, and a refund timer can be unsafe once a bank payment has been sent. Pactlane focuses on one EUR payment rail and one whole offer, with a payment lock before instructions and an explicit recovery path if verification fails.

The intended first users are people who already hold a Stellar wallet and want small EUR trades with a counterparty they can reach. This is a proposed pilot group; no customer interviews, adoption, liquidity or pilot commitments are claimed.

## What we built

A buyer/seller interface, Soroban escrow, operator-run payment-policy service, durable replay registry and canonical signed claim format. The contract checks the configured policy signature, binds the order and deployment, consumes a stable payment identity and releases at most once.

The local live-service implementation connects Freighter, authenticated browser sessions, coherent chain reads, transaction journaling and reconciled receipts. Mutual recovery uses an exact seller Soroban authorization followed by the buyer's final transaction signature. Both parties review the split; seller approval alone is not settlement. Amounts stay exact integer units throughout.

The existing local rehearsal executes the compiled escrow WASM with the policy signer and synthetic payment evidence. Separate browser/HTTP checks use fixture signatures and mocked chain services. These are implemented and locally checked components, not a deployed payment-to-chain trade.

## Why Stellar

Soroban provides the programmable escrow and atomic one-use release. Freighter provides wallet approvals; the pinned Stellar SDK supplies transaction, authorization and XDR handling. Those are concrete integrations in the code. TLSNotary is the intended source of authenticated bank-response evidence, while a configured operator interprets the disclosed fields and signs the contract's canonical claim.

Proposed path: Genesis / Stellar Composed, subject to organizer eligibility judgment. The [FAQ](https://www.hackmeridian.com/faq) permits early prototypes in Genesis and describes Composed as combining at least two ecosystem tools or projects. This draft does not claim eligibility has been confirmed.

## Trust and recovery

Revolut supplies the payment record. The verifier authenticates its source; the operator checks payment meaning and signs the claim. The escrow verifies that signature rather than a raw bank transcript. The operator receives selected disclosed fields, and Stellar settlement is public.

After payment is locked, unavailable proof holds the tokens. A timely payment can be verified later, or both parties can authorize a release, refund or split. There is no unilateral post-lock timeout refund. An uncooperative party can leave a trade unresolved. Manual recovery also requires complete payment-identity reconciliation before the policy resumes signing.

## What remains unfinished

A real authenticated payment has not been accepted. The latest proof disconnect matched a Fly trial-machine shutdown; the later paid-host uptime observation did not establish payment proof. Bank tests remain paused, and live normalization rejects unknown payment semantics. The live host therefore blocks new payment locks.

An approved testnet deployment, real wallet/trade validation, reachable hosted handoff, reviewer access and portal submission remain outstanding. A local 90-second silent video and seven-slide PDF deck are prepared and checked; their final acceptance still depends on owner review and the portal's media limits. See the [media handoff](release/submission-package.md). Screenshots and receipt examples from local browser rehearsals are labeled mocked. No deployed contract, real payout, transaction link or customer traction is invented for this submission.

## Progress and next pilot

Preparation preceded the event; the repository preserves that history. Event progress should be described using the actual commit timeline: integrated app/policy/escrow, imported TLS evidence, authenticated host/browser wiring, durable transaction recovery and two-party authorization. Do not describe all prior work as having been created during the event.

The next pilot is one consented, measured trade through the accepted payment normalizer and an authorized Stellar testnet deployment. Record completion time, failure stage, replay rejection and both token balances. A separate order should demonstrate mutual recovery. Only after that evidence should the project expand to more users or another payment rail.

## Materials to attach

Use the reviewed private repository revision, the silent video for Vijay's dub, the pitch deck, and verified contract/transaction links if an authorized deployment actually exists. Confirm the portal's duration, file and slide limits and named reviewer-access requirements before upload. This draft has not been submitted or sent to anyone.
