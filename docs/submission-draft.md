# Pactlane submission answers

## One sentence

Pactlane connects bank payments to Stellar: buy USDC from another person through Revolut, with tokens held in escrow and payment evidence checked before release.

## Problem and audience

People who already use Revolut and a Stellar wallet need a clear route between the two. Liquidity suppliers need a way to quote a price, receive euros and release tokens with confidence. Pactlane brings both sides into one trade with an upfront quote, funded escrow and a shared receipt.

The first audience is EUR users who want Stellar USDC for a specific app, recipient or self-custody use case. We start with one payment rail so the trade can be understood and measured from end to end.

## What we built

A buyer and seller interface, a Chrome payment-proof extension, authenticated Revolut-record ingestion, a payment-policy service and a Stellar escrow. The browser and host support wallet authentication, confirmed chain reads, transaction recovery and exact approvals from both wallets for mutual resolution.

The seller funds a whole offer. The buyer reserves it and confirms the payment lock before sending euros. The payment service checks source, recipient, payer binding, amount, currency, completion time and payment reuse. Its signed claim authorizes a single contract release.

## Why Stellar

Stellar Smart Contracts enforce escrow and atomic token movement. Freighter supplies wallet approval; the Stellar SDK handles transaction encoding and authorization. TLSNotary authenticates the source response. Combining these tools creates a direct route from an everyday payment account to a Stellar wallet.

The proposed Genesis track is Stellar Composed. The implementation also demonstrates core contract capabilities through explicit payment states, replay protection and two-party recovery.

## Technical results

The verifier accepted an authenticated completed Revolut transfer record. Separately, the reviewed escrow WASM was deployed and exercised on Stellar testnet with PLTEST: funding, reservation, payment lock, signed release, replay rejection and mutual recovery all passed. The public Demo mode walks through the product using sample payments.

[Verification evidence](verification.md) links each result to its source. [Current status](status.md) records the remaining mainnet connection; a new mainnet transaction receipt belongs there when available.

## Innovation

Pactlane applies the proof-based peer-to-peer exchange model to Stellar, inspired by ZKP2P. The implementation connects the payment’s authenticated record to a specific locked order and durable replay protection. Recovery is part of the product flow: both parties can agree on the exact allocation without an operator withdrawal shortcut.

## Progress during the event

The Git history records preparation and hackathon work. Key milestones include the buyer/seller app, policy and compiled escrow integration; cloud proof verification; the Pactlane extension; accepted Revolut-response parsing; wallet and recovery services; testnet escrow execution; and the public website with separate demo and live modes.

## Adoption and continuation

Run a small EUR pilot with repeat liquidity suppliers. Measure successful trades, time to completion, quote availability, verification time, recovery frequency and repeat use. Improve the busiest points of friction before adding payment rails or larger order sizes. The ambition is a marketplace where existing payment apps become practical entry points to Stellar.

## Trust and data

Pactlane’s operator interprets authenticated payment evidence and controls the signer trusted by the contract. The current bank check shares a complete transfer response after consent. Stellar settlement is public. After payment locks, recovery needs both wallets; funds stay held if neither valid verification nor agreement completes.

## Submission materials

Use the [demo](https://pactlane.io/?demo=1), this repository, the current pitch deck and the updated walkthrough. The [morning capture list](demo/shot-list.md) separates product screens from bank and chain evidence. Confirm the portal’s fields, track selection and reviewer access, then retain the submission receipt. Deadline: **26 October, 12:00 Lisbon time**, according to the [official schedule](https://www.hackmeridian.com/schedule).
