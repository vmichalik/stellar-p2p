# Pactlane app handoff

Objective: a complete buyer/seller demo matching the current escrow lifecycle, with explicit payment lock and mutual recovery. Execution host: Vijay’s Mac mini, 25 October 2026. Worktree: `/Users/vijay/Documents/workspace-personal-projects/pactlane-ui`. Branch: `codex/pactlane-ui`. Base: `807412686da2cdad494ee284675dbefc35110257`. The scoped component commit is this branch’s HEAD and is supplied in the thread completion. Use `git rev-parse HEAD` and `git status --short` before integration. No push, deployment, live wallet or bank action was performed.

Read alongside the coordinator’s `/Users/vijay/Documents/workspace-personal-projects/stellar-p2p/docs/coordination.md` and the current `/Users/vijay/Documents/workspace-personal-projects/pactlane-escrow/contracts/escrow/README.md`, `interface.json` and `protocol/` files. Those workstreams own canonical contract/policy encoding. This component does not copy or redefine it.

## Run

```sh
node scripts/serve-app.mjs
node --test app/*.test.mjs
node --test tlsn/*.test.mjs app/*.test.mjs
node scripts/check.mjs
```

The server binds only `127.0.0.1:17860`; override with `PACTLANE_UI_PORT`. It serves bundled Manrope and has a CSP with `connect-src 'none'`. The demo adapter has no bank, RPC, wallet, policy or signing connection. The server is stopped after verification; start it with the command above. The proof gateway and its existing private route were not changed.

**Remote preview: unavailable.** No third-party-reachable URL has been published or verified. A Mac-mini loopback address is not a MacBook/Windows handoff. Screenshots in this directory can be reviewed without publication.

## Implemented scope

The accepted cream/orange/Manrope Pactlane design has Buy USDC, Sell USDC and My trades. Both fictional participants share one local browser fixture; this is not multiuser authentication or cross-device synchronization.

Ben starts with 22 demo USDC. He connects his demo wallet, creates one fixed whole offer (default EUR 20 / 22 USDC), reviews a deposit and funds it. Ana connects her separate demo wallet and reserves that exact offer. Partial fills are rejected. A consumed order cannot be recycled after release, refund or mutual resolution.

Reservation shows a payment-lock screen, without the Revolut tag, recipient instructions or payment-report action. Only a confirmed demo lock shows payment instructions. A failed or interrupted lock returns to the reserved state with instructions hidden. A failed proof leaves USDC held and offers retry or mutual recovery, with a clear instruction not to pay again.

An already Paying buyer can return after `pay_by` and report/verify a transfer made earlier. After the deadline, the UI hides new-payment instructions while retaining the existing-payment verification action. The live policy must establish the actual bank payment timestamp; the demo report does not establish it.

Mutual recovery proposes a full return, full release or equal split. Ana and Ben review and approve the same allocation in their own demo views. One approval cannot confirm resolution. Confirming both approvals allocates tokens once, closes the offer and reconciles both balances. A later valid payment check can still settle while a proposal is pending. Unlocked reservations may be refunded after expiry; there is no unilateral refund after payment lock.

Normal verification and settlement produce a receipt and matching seller activity. The order reference is assigned at funding and retained through reservation, lock, verification, resolution and receipt on both sides. Receipts clearly identify simulated settlement and have no invented explorer hash/link. Browser storage contains only the demo fixture; refresh never invents confirmed funding, locking, proof or settlement. Demo settings choose lock and proof failures and allow an explicit reset.

## Integration boundary and mapping

`app/demo-adapter.mjs` is the only running adapter. `app/live-adapter.d.ts` is a **proposed production service interface**, not an implementation. The app currently imports the demo adapter directly; adding a deployment configuration cannot silently turn it live.

| App action/state           | Contract/service source required for live integration                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seller creates offer       | Draft fixed `Terms`; exact EUR cents, token base units, recipient commitment, expiry and reservation duration                                                                   |
| `fundSellerOffer` / funded | Wallet-authorized `fund(terms)`; confirmed transaction, returned order ID, then authoritative `get_order`                                                                       |
| `reserve` / reserved       | Buyer-authorized `reserve(order_id, buyer)`; confirmation then re-fetch `get_order`                                                                                             |
| `beginPayment` / locking   | Buyer-authorized `begin_payment(order_id)` remains pending; no instructions                                                                                                     |
| paying / instructions      | Confirm transaction and re-fetch `get_order`; require `State::Paying`, matching buyer and nonzero `locked_at`, with time remaining before `pay_by`                              |
| proof progress             | TLSNotary extension progress only; never changes authoritative payment acceptance                                                                                               |
| verification failed/retry  | Trusted policy status unavailable/rejected; retain on-chain Paying lock; retry remains available after the deadline for an earlier payment                                      |
| verified                   | Trusted payment policy checks authenticated bank evidence against the actual on-chain order and issues its order-bound authorization                                            |
| `settle` / settling        | `release(claim, signature)`; browser callbacks cannot authorize it                                                                                                              |
| completed / receipt        | Confirm actual release on the configured network/contract, re-fetch `get_order`, reconcile token transfer amounts and destination, then attach the actual transaction hash/link |
| refund expired             | `refund(order_id)` only for expired Reserved; never use this path for Paying                                                                                                    |
| mutual agreement           | Both wallets authorize the same `resolve(order_id, buyer_tokens)` call; exact allocation and network/contract/order binding; confirm and reconcile both token transfers         |

Contract IDs/timestamps/amounts cross the production boundary as decimal strings or bigint, not JS floating point. Contract time is Unix seconds; demo UI time is milliseconds. Pin the wallet network, token/decimals, contract and policy service. Read authoritative `get_order` after confirmation and on reload; never restore live payment authority from browser storage. The UI-only statuses (`locking`, `verifying`, `verified`, `settling`) must stay separate from chain states.

Real mutual authorization must approve a single canonical call, rather than trusting the demo’s approval booleans. Manually resolved bank payments need policy-side reconciliation to prevent later reuse; resolution itself has no payment nullifier. Canonical claim encoding and shared vectors remain with contracts/policy.

## File manifest

- `app/index.html`, `app/styles.css`, `app/app.mjs`: app document, responsive UI and actions.
- `app/model.mjs`, `app/demo-adapter.mjs`, `app/model.test.mjs`: isolated synthetic state, adapter and regression tests.
- `app/live-adapter.d.ts`: proposed live service types and confirmation boundary.
- `app/assets/fonts/manrope.woff2`, `app/assets/fonts/OFL.txt`: bundled font and license.
- `scripts/serve-app.mjs`: loopback static preview.
- `docs/ui/handoff.md`, `docs/ui/screenshots/`: scoped handoff and synthetic screenshots.

The component commit intentionally excludes shared root README/package changes. The release integrator should add these scripts to the root package:

```json
"dev:app": "node scripts/serve-app.mjs",
"test:app": "node --test app/*.test.mjs"
```

Extend the existing `test` command to `node --test tlsn/*.test.mjs app/*.test.mjs`, and add the app/handoff links to the canonical README. These additions were exercised locally during development, then removed from this component’s root files to keep integration ownership clear.

## Verification

Automated: 46 tests pass (14 app, 32 existing TLSNotary); 23 JavaScript/module syntax checks pass; the proposed live service declaration passes TypeScript strict checking using the existing local compiler; scoped formatting and `git diff --check` pass. Tests cover whole-offer rejection, single consumption, confirmed lock, failed lock, proof failure retaining escrow, late return after `pay_by`, hiding new-payment instructions after deadline even when payment was reported, exact two-wallet allocation, duplicate resolution/release, interrupted-work recovery and matching seller/buyer balances.

One combined check run executed alongside other checks failed the existing `public extension diagnostic pins all destinations and keeps the launcher CSP` test (`null` status instead of 200). The isolated test and a subsequent full-suite run both passed. Its dispatch helper polls only 20 `setImmediate` turns while the handler reads files, so timing sensitivity is a plausible explanation, not a proven diagnosis. TLSNotary source is unchanged by this component; this intermittent baseline failure remains for the proof/release workstream to resolve.

Browser rehearsal against the loopback demo:

- Ben creates/funds 22 USDC → Ana reserves it. No Revolut tag, copy control or payment-report action is visible before the lock.
- An unavailable lock keeps those controls hidden; refresh and retry confirms the lock before instructions appear.
- Proof failure → equal-split proposal → Ana approval alone has no confirmation action → Ben approves → agreed resolution sends 11 demo USDC to each wallet and leaves zero in escrow, with no verified EUR claim.
- A separate reset/rehearsal follows the full confirmed-lock → proof → release → receipt path; the same order/amounts reconcile in the seller view.
- Marketplace, lock, payment, receipt and seller layouts are checked at 1024, 768, 390 and 320 pixels; no horizontal overflow. Mutual recovery was rehearsed on desktop. Key views are saved in `screenshots/`. Browser error/warning logs are checked on the final version.

The deadline regression is tested with explicit synthetic timestamps; no real-time browser clock or bank payment was changed. This is UI/model evidence only. No authenticated payment proof, policy signing, wallet authorization, RPC transaction or on-chain settlement was tested here.

## Remaining work

Release integration must implement the wallet/RPC/policy service boundary, actual authenticated evidence acceptance, confirmed receipts and a third-party-reachable preview under existing authorization. Contract/proof source state remains owned by those workstreams. Mutual approval is simulated here. No bank credentials, raw proofs or private runtime configuration are included.

Next action: integrate this scoped component commit, add the root scripts/README links above, then run the same lifecycle against the actual contract and trusted policy adapter. The original main checkout’s unrelated changes remain untouched. No cross-thread messages were sent by this component.
