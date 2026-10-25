# Explaining Pactlane

Use the short explanation that fits the conversation. The public app and local compiled-contract rehearsal are synthetic. A disposable testnet rehearsal passed with synthetic PLTEST: release, replay rejection, and mutual recovery. No authenticated bank payment or real USDC settlement has been validated.

## 30 seconds

“Pactlane is a prototype for direct EUR-to-USDC trades between two people. The seller locks one fixed offer in Soroban escrow; the buyer reserves it and confirms the payment window before sending euros. A policy service checks the evidence and signs a short-lived release claim; the contract checks the order and signature before paying once. The public app and local WASM rehearsal use synthetic payment data. A separate disposable testnet rehearsal passed release, replay rejection, and mutual recovery using PLTEST and programmatic wallet keys. We have not validated an authenticated bank payment, Freighter UI, or real USDC settlement.”

## Two minutes

“The product problem is that someone may already have a bank account and want USDC on Stellar, but would rather not open another exchange account and hand over another copy of their identity documents. Pactlane lets one person offer a fixed amount of USDC for euros paid directly to them. The seller funds the whole offer first, and the buyer reserves it. Before the payment instructions appear, the buyer confirms an on-chain lock, which removes the seller's unilateral timeout option while proof is pending.

“The privacy idea is to use TLSNotary to authenticate a selected bank response and disclose only what's needed. Then an off-chain policy checks the verified payment against the exact order, recipient commitment, amount and payment time. It creates a canonical Ed25519 claim. Soroban does not inspect the bank proof: it checks that the claim matches the stored offer, came from its configured signer, is in time, and uses a payment nullifier that has not already been spent. That separation is the main trust decision: the chain enforces the escrow mechanics, while users still trust the policy operator's interpretation and key.

“We have a synthetic public flow and a local integration rehearsal that ran through the policy and compiled contract, paid out a synthetic token, and rejected replay. The separate disposable testnet run deployed the reviewed WASM, paid 220,000,000 PLTEST atoms for a synthetic claim, rejected replay, and resolved another order with 110,000,000 atoms to each party. It used programmatic disposable keys, not the Freighter UI. The live evidence adapter refuses to sign because accepted real source and recipient identities and units have not been established. So this is a synthetic testnet integration pass, not an authenticated payment trade.”

## Technical version

“Protocol v1 commits the recipient as a salted SHA-256 hash over canonical ScVal-XDR containing the fixed source namespace, exact provider recipient ID, and 32-byte offer salt. The payment nullifier hashes the fixed namespace, source origin, payer scope and stable payment ID, while excluding order and network so the same transfer remains consumed across deployments. The policy binds those values to a fresh confirmed order snapshot, checks strict integer amounts and timestamp bounds, atomically reserves the nullifier in durable SQLite before signing, and signs SHA-256 of canonical claim XDR. The contract checks network ID and contract address domain separation, all stored terms, `locked_at <= paid_at < pay_by`, ledger time, claim expiry, signature, and its per-deployment used-nullifier set before changing state and transferring tokens atomically.

“TLSNotary authenticates transcript bytes under its MPC-TLS assumptions. It does not establish our semantic mapping from source fields to account scope, recipient ID, transfer ID, amount unit or completion semantics. The contract does not verify TLSNotary at all; it trusts the policy public key fixed at construction. The host/browser path and two-party recovery collector are implemented in source, and that recovery path has passed a disposable testnet run using programmatic keys. We still need an accepted live evidence schema/normalizer, real Freighter validation, and production service controls. Until live evidence is accepted, the payment policy stays fail-closed.”

## Likely judge questions

**Is it trustless?** No. The policy operator and signer are trusted to interpret verified evidence correctly. The contract independently enforces the escrow and signature rules, but cannot prove the bank-payment semantics itself.

**Is the payment private or anonymous?** No. The bank sees the payment; the counterparty sees payment details; Stellar addresses, order state, and token movement are public. The system aims to reduce extra identity-document collection and expose only selected proof data to Pactlane. Some identities map to deterministic pseudonymous nullifiers.

**Is it zero knowledge?** Do not call the whole system “fully ZK.” TLSNotary uses MPC-TLS and selective transcript disclosure. The on-chain claim is a signed authorization; the contract does not verify a ZK proof or TLS transcript.

**What happens if verification fails after payment?** The escrow remains in `Paying`; it does not time out to the seller. The buyer may retry with valid evidence later, or both wallets can authorize a split through recovery. If evidence never becomes usable or the other party refuses recovery, funds can remain locked.

**Can the same payment be used twice?** A nullifier is derived from stable payer scope and payment ID. The contract rejects reuse within one deployment, and durable policy storage plus chain reconciliation are required to reject reuse across deployments. The real-source identity mapping has not been validated yet.

**What has actually been tested?** The local synthetic app-to-policy-to-canonical-signature-to-compiled-WASM path, including a payout and replay rejection. A separate disposable testnet rehearsal passed with the reviewed WASM: synthetic PLTEST release, replay rejection, and mutual half-split recovery. It used programmatic disposable wallet keys. There is no authenticated bank payment, real USDC settlement, or Freighter UI validation.

**Why not just use an exchange?** Some people already have the payment account and want USDC on Stellar without another intermediary's onboarding. For users happy with an exchange or direct on-ramp, there may be no reason to switch. Pactlane still needs to prove that the privacy benefit and direct-trade pricing are worth the proof and wallet steps.

**What about disputes or fraud?** The design deliberately avoids an operator override. Valid policy proof can release to the buyer; recovery requires both wallets. This limits unilateral intervention but can leave an order stuck. Payment reversibility, fraud handling, support, and legal obligations need more work before production.

**Does it support MB WAY?** No. The current contract accepts EUR and the `revolut` rail, and the frozen proof namespace names `app.revolut.com`. MB WAY would need an authenticated source, reviewed field semantics and identities, protocol/contract support, fresh vectors and another deployment. It is not an existing feature.

**What can a compromised signer do?** It can attest to a false payment for a locked order and release tokens to that order’s recorded buyer. It cannot change the stored buyer, token or amount through a claim, or withdraw a funded, unreserved offer using `release`. The policy key is a substantial trust assumption.
