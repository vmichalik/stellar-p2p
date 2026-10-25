# System map

| Component        | Responsibility                                                                | Source                                                           |
| ---------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Browser          | Show funded offers, collect choices and display confirmed trade progress.     | `app/entry.mjs`, `app/live-app.mjs`, `app/live-view-adapter.mjs` |
| Wallet transport | Authenticate the wallet and obtain approval for the exact request.            | `app/host-client.mjs`, `app/freighter-connector.mjs`             |
| Host             | Coordinate chain reads, wallet actions, private offer data and policy status. | `integration/host-runtime.mjs`, `integration/browser-bridge.mjs` |
| Proof verifier   | Authenticate the selected bank response.                                      | `tlsn/revolut.plugin.mjs`, `tlsn/benchmark/gateway.mjs`          |
| Evidence parser  | Validate response structure and normalize the transfer record.                | `policy/src/tlsn-record.mjs`, `policy/src/evidence.mjs`          |
| Payment policy   | Match evidence to the order and authorize one release.                        | `policy/src/engine.mjs`                                          |
| Replay registry  | Reserve and retain payment identities across orders and deployments.          | `policy/src/replay-store.mjs`                                    |
| Escrow           | Hold tokens and enforce funding, lock, release and recovery rules.            | `contracts/escrow/src/lib.rs`                                    |

The browser supplies an order ID and an opaque evidence reference. Trusted server readers supply the bank record, chain state and private recipient binding. A browser status message never becomes payment authorization.

Demo mode loads `app/demo-adapter.mjs` and local sample state. Live mode loads the host client. Switching mode reloads the document, keeping sample balances and receipts out of the live flow.
