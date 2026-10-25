# Bank proof status

The verifier accepted a complete authenticated Revolut transfer record at **23:08:23 UTC on 25 October 2026**. The record passed source, response-context, completed outgoing EUR and identity checks. [Acceptance evidence](../evidence/release/complete-record-accepted.json).

Earlier checks established the public proof connection, an authenticated HTTP200 response with an array root and seven required payment fields. The complete-record check added the authenticated context needed for server parsing.

| Check                  | What it establishes                                                    |
| ---------------------- | ---------------------------------------------------------------------- |
| Setup / public proof   | The client and verifier can complete that diagnostic session.          |
| Response / field check | The authenticated response shape and required fields are present.      |
| Complete record        | The verifier accepted the authenticated transfer record.               |
| Order policy           | That payment satisfies the new locked order and has not been consumed. |
| Chain receipt          | The configured escrow transferred tokens.                              |

The historical accepted transfer predates the proposed new order. [Current trade status](status.md) and the [operator runbook](release/mainnet-test.md) cover the remaining mainnet connection.
