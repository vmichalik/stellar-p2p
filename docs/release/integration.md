# Pactlane integration candidate

This branch integrates frozen component handoffs and the local rehearsal. It leaves main's dirty proof material and the other worktrees intact.

## Intake

| Component             | Source snapshot                                                                                 | Integrated commit                                        |
| --------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Escrow/protocol       | `5be4b168102a53160a3d7423b98d3627f25e806a` + handoff `6196df363e4b711dc1a0cf3c2b7cab8aa0bf0a78` | `7d12fe5` + `ae23f97`                                    |
| Payment policy        | `52600e2afd68363369486b3d7e098c0e95d248c0` + handoff `dd7259c`                                  | `aaf2566` + `b4af19d`                                    |
| Buyer/seller app      | `f4c6c42`                                                                                       | `b975419a805c0e5273be0b801c3f9db5c64630b2`               |
| Release runtime       | App/policy/WASM bridge, durable wallet/RPC candidate, root scripts                              | `006ab023e4d44600d03f320f220457e5b5545f0e`               |
| Cloud proof runtime   | Owner lane active                                                                               | Local snapshot through `2c98f8e` integrated              |
| Video/deck/submission | Separate artifact owner                                                                         | Revised narration/shot list imported; final MP4 separate |

Canonical encoder, policy copy and vectors pass exact hash checks. Frozen WASM rebuild is byte-identical. Later formatting of component docs/test scripts does not alter the protocol or contract source.

## Rehearsal results

Fixed whole offer, confirmed lock before instructions, failure retaining funds, late timely-payment proof, one signed release, contract/policy replay and duplicate UI settlement all pass locally. Native/WASM escrow suites include mutual settlement, authorization and conservation. Browser rehearsal passes the synthetic seller-to-buyer failure/retry/receipt path and persisted reload; component-owner evidence covers the two-wallet synthetic recovery path.

See [verification](../verification.md) for counts and [the recorded local run](../../evidence/release/local-wasm-rehearsal.json). This branch does not turn synthetic fixtures into live payment evidence.

## Gaps

- Live proof operation and authenticated response semantics remain with the proof owner; `NOT_CLEARED`. Reviewed source is integrated locally; new proof-domain routing is still pending.
- Browser wallet/host transport, authenticated policy routes/readers/indexer and dual-wallet recovery collection remain software work.
- Approved token/signer/deployer/fee configuration and network execution remain unestablished.
- Static demo exists locally; no public app URL or separate-device reachability established.
- Final silent video/deck, portal limits/timezone, reviewer access and submission remain with owner/coordinator.

No new bank disclosure, account, funding, hosting, repository visibility, invitation or final-submission action is inferred from this integration.

Final domain intake: UI polish `572f2b9` is integrated as `4181b31`, policy presentation `668adfc` as `9be14e2`, contract copy audit `8ef8b6b` as `601440d`. Frozen contract/encoder bytes remain unchanged. See [domain handoff](DOMAIN-HANDOFF.md) for the exact ready artifact and external steps.
