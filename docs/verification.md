# Verification

## Completed mainnet trade

On 26 October 2026 at 09:52:33 UTC, order 0 released **1 Circle USDC** to the buyer after an authenticated **EUR 0.89 Revolut payment** matched the locked order. The release succeeded in ledger 65144514. RPC token events and before/after balance reads confirm the buyer received exactly 1 USDC and escrow now holds zero. The payment's on-chain one-use marker is set, and the durable policy record is settled.

[Release transaction](https://stellar.expert/explorer/public/tx/ec4220af4056b185d242977385484066789824a2a274f57b3439e1e4dd1b9864) · [Readable receipt](release/mainnet-result.md) · [Sanitized evidence](../evidence/release/mainnet-trade-2026-10-26.json).

## Bank proof

The complete-record check accepted an authenticated completed outgoing Revolut transfer at 23:08:23.290 UTC on 25 October 2026. The receiver checked the TLS source, response context, transfer semantics, exact integer cents and bank identity fields. [Sanitized acceptance](../evidence/release/complete-record-accepted.json).

## Stellar testnet

The testnet rehearsal deployed the reviewed escrow WASM and completed funding, reservation, payment lock, signed release and mutual recovery with PLTEST. The run also rejected replay. [Full record](../evidence/release/testnet-rehearsal-2026-10-25.json).

- [Release transaction](https://stellar.expert/explorer/testnet/tx/7acb287096e02b15c80b4c18b0485612efed95fd7b5e83c5e5b1be11cbe1ae5d)
- [Mutual recovery transaction](https://stellar.expert/explorer/testnet/tx/866f81532c6cc42c21e9a98f751440c4917b77ee3aad97a7eb81774e41a85165)

The testnet run used a test asset and programmatic wallet keys. It establishes contract and settlement behavior separately from the authenticated bank-record check.

## Application and policy

The current integrated review passed **401 JavaScript tests**, eight Python staging checks and 138 syntax checks. Its 11 extension-watchdog cases were skipped because that separate prepared package was absent; the extension repository owns those tests. Earlier contract verification ran 29 scenarios in both native and compiled-WASM modes and 11 shared-protocol cases. The unchanged escrow was not rebuilt for this review.

The published mode-toggle build passed 102 app/release tests and a full browser trade, including funding visibility, reservation removal, mode isolation and mobile layouts. [Browser evidence](../evidence/release/demo-mode-browser-2026-10-25.json), [published assets](../evidence/release/demo-mode-live-2026-10-25.json).

Run the current combined suites with `npm run test:all` and `npm run check` after [setup](setup.md). The review handoff records the latest actual run; [status](status.md) includes the completed mainnet trade.

The review also completed a fresh sample recovery with both approvals, the integrated live-host browser check and 18 video composition snapshots with deterministic seeking. [Current review receipt](../evidence/release/judge-review-checks.json).

[Public verification](../evidence/release/judge-review-publication.json) matched all 42 website assets to source `8b9d653`, including the refreshed 90-second film.
