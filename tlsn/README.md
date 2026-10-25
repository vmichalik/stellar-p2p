# Bank payment proofs

Pactlane uses TLSNotary to authenticate a Revolut transfer response. The owner selects the transfer and reviews its disclosure in the Chrome extension. The verifier’s private receiver parses the authenticated record for the payment service.

| File                            | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `revolut.plugin.mjs`            | Capture the selected transfer request and generate the requested proof. |
| `payment-record.html`           | Complete-record consent and result page.                                |
| `payment-check.mjs`             | Validate proof-session output for the payment check.                    |
| `benchmark/gateway.mjs`         | Route the configured verifier and bounded public diagnostics.           |
| `extension-check.*`             | Public connection proof using GET /robots.txt.                          |
| `response-check.*`              | HTTP and JSON response inspection.                                      |
| `setup-check.*`                 | MPC setup timing without a bank request.                                |
| `../policy/src/tlsn-record.mjs` | Validate framing, response context and transfer semantics.              |
| `../policy/src/tlsn-store.mjs`  | Store accepted normalized evidence behind a private interface.          |

Plugins run in the extension’s QuickJS runtime. Keep URL and request matching compatible with that environment. The gateway fills verifier/transport settings from its configured origins; they are not browser-selected destinations.

The complete-record path was accepted on 25 October. [Proof status](../docs/proof-status.md). Setup and public checks remain separate diagnostics. The payment service must bind an accepted transfer to a locked order before release.

[Install the extension](https://github.com/vmichalik/pactlane-tlsnotary) · [Operator continuation](../docs/release/mainnet-test.md) · [Data handling](../docs/architecture/privacy-and-data.md)
