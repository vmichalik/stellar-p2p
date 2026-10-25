# Build and verification

Checked on the Mac mini, 25 October 2026. This page is the current record; dated artifacts retain the scope of their original runs.

| Part                | Observed result                                                                                                   | Evidence                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Website             | Published at pactlane.io, with separate demo and live modes, mobile navigation and funded-offer filtering.        | [Website receipt](../evidence/release/demo-mode-live-2026-10-25.json)         |
| Bank record         | Authenticated completed Revolut transfer accepted by the verifier at 23:08:23 UTC.                                | [Acceptance](../evidence/release/complete-record-accepted.json)               |
| Stellar escrow      | Testnet deployment, release, replay rejection and mutual recovery passed using PLTEST.                            | [Testnet transactions](../evidence/release/testnet-rehearsal-2026-10-25.json) |
| Product flow        | Seller funding through buyer receipt, including failure and recovery states.                                      | [Browser checks](../evidence/release/demo-mode-browser-2026-10-25.json)       |
| Payment policy      | Exact amounts, order/time binding, durable replay protection and canonical signatures are implemented and tested. | [Policy](../policy/README.md)                                                 |
| Live browser / host | Wallet sessions, transaction journaling, confirmed reads and two-party recovery are implemented.                  | [Integration](../integration/README.md)                                       |

## Mainnet connection

The approved small-trade target is **1 USDC for EUR 0.89**. The public website’s exchange API is not attached yet, and no mainnet escrow release receipt is recorded here. Finish the durable operator configuration, wallet-to-bank bindings, signer and deployment/funding/lock before the new payment. Payment release remains `NOT_CLEARED` until that trade is verified and settled.

The accepted historical bank transfer and PLTEST rehearsal are separate results. The historical transfer predates the proposed new order and cannot pay for it. [Operator continuation](release/mainnet-test.md).

## Current review

The judge-facing documentation and demo are consolidated on `codex/pactlane-judge-review`. [Handoff](handoff.md) records the final commit, checks and publication receipt. [Verification](verification.md) is the short evidence index.
