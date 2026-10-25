# From a bank response to payment evidence

TLSNotary authenticates disclosed bytes from a TLS session with the bank. Pactlane then interprets those bytes as a transfer record and checks the record against an order.

The accepted source is the Revolut transaction-detail response. The current complete-record path verifies HTTP200, complete response framing and JSON structure before reading the transfer. It checks the requested transfer ID, completed outgoing transfer type, EUR amount, completion time and provider-issued identities.

## Amounts and identities

An outgoing `amount: -500` means a EUR5.00 debit in the accepted schema. The parser normalizes the sign and retains integer cents. It rejects ambiguous or incomplete records instead of filling fields from browser state.

The payer scope comes from the record’s registered identity; the recipient uses the provider’s recipient identity. Those bank identities still need an approved binding to the wallets participating in a new trade. Display names and user-entered tags are useful instructions, not identity proof.

## The extension

[Pactlane TLSNotary](https://github.com/vmichalik/pactlane-tlsnotary) uses the pinned TLSNotary runtime with a 60-second setup deadline and Pactlane styling. The app preserves the captured application headers needed for the bank request. The owner reviews the requested disclosure in the extension.

The complete-record verifier accepted a transfer on 25 October. [Acceptance evidence](../../evidence/release/complete-record-accepted.json). Public connection and setup checks remain useful diagnostics, with separate outcomes from transfer validation.

The contract receives a signed payment claim, not the raw bank transcript. [Policy](policy-and-claims.md) describes the next step.
