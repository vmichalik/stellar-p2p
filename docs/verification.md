# Verification

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

Run the current combined suites with `npm run test:all` and `npm run check` after [setup](setup.md). The review handoff records the latest actual run. The remaining end-to-end mainnet result belongs in [status](status.md), with its transaction receipt.

The review also completed a fresh sample recovery with both approvals, the integrated live-host browser check and 18 video composition snapshots with deterministic seeking. [Current review receipt](../evidence/release/judge-review-checks.json).
