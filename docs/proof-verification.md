# Proof verification

The [verification index](verification.md) links the accepted bank record, testnet transactions and application checks. [Proof status](proof-status.md) explains what each proof stage establishes. [Operations](proof-handoff.md) records the deployed image and data handling.

The complete-record parser checks the actual shipped WASM parser with framed synthetic HTTP responses. Receiver tests cover authenticated ingress, full response coverage, completed outgoing EUR semantics and integer cents. Store-to-policy checks cover payer/recipient/amount/time binding, restart idempotence and replay across orders and deployments.

The setup-timeout tests belong to the [extension repository](https://github.com/vmichalik/pactlane-tlsnotary). A public proof checks the connection; the accepted transfer record checks bank evidence; the order policy and chain receipt establish settlement for a particular trade.

Dated diagnostic and deployment receipts remain under [evidence/release](../evidence/release/). Earlier failure investigations are preserved in Git history.
