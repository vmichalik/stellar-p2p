# TLSNotary prototype

The active code is here. Start with [setup](../docs/setup.md), then read [status](../docs/status.md) before running a bank test.

| File                                | Job                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `launcher.mjs`, `launcher.html`     | Private gateway, pinned readiness checks and transfer-test UI               |
| `revolut.plugin.mjs`                | Explicit-click proof of a selected transfer or limited response-shape check |
| `extension-check.*`                 | Fixed public GET proof through the installed extension                      |
| `setup-check.*`                     | Browser-worker MPC setup without a bank request                             |
| `browser-setup-smoke.mjs`           | Optional isolated Playwright setup/public-request diagnostic                |
| `setup-smoke.rs`                    | Optional native setup-only diagnostic                                       |
| `prepare-verifier.py`               | Narrow restrictions for the pinned upstream source                          |
| `verifier-local-restrictions.patch` | Reviewable copy of those source changes                                     |
| `*.test.mjs`                        | Synthetic behavior and boundary checks                                      |

Plugins run in the extension’s QuickJS environment. They have no DOM `URL` class; keep their destination checks compatible with that runtime. Their `VERIFIER_ORIGIN` and transport constants stay empty in source and are filled only by the configured gateway.

All current callbacks are diagnostic. `NOT_CLEARED` must remain the outcome until an independent payment-policy service verifies an order-bound claim.
