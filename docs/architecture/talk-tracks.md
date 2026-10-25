# Explain the architecture

For a short pitch and judge questions, use [Explain Pactlane](../pitch.md).

For a technical audience: TLSNotary authenticates the bank response; a server-side policy matches the transfer to a confirmed locked order, reserves the payment identity in SQLite and signs canonical claim bytes. The Stellar escrow verifies the configured signature, order terms, time bounds and unused nullifier before transferring tokens atomically.

The key design choice is the operator-signed payment claim. Users trust that operator’s evidence interpretation and signer. The contract independently enforces who receives which tokens and prevents reuse within the deployment. Cross-deployment reuse is handled by the durable policy registry and chain reconciliation.

The most useful demonstration is one successful trade followed by a replay rejection and, on a separate order, a recovery approved by both wallets. Point to [verification](../verification.md) for the observed runs.
