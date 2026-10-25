# Pactlane UI polish handoff

Objective: improve the existing buyer/seller walkthrough’s clarity, exact amounts, accessibility and mobile action placement. Execution host: Mac mini, 25 October 2026. Repository: private `vmichalik/stellar-p2p`. Worktree: `/Users/vijay/Documents/workspace-personal-projects/pactlane-ui`. Branch: `codex/pactlane-ui`. Base component: `f4c6c425980785b492e76ded1f8211544d39d7a5`. The new scoped revision is supplied in the completion message and is this branch’s HEAD. No push or deployment was performed.

## Scope and integration

Contract semantics remain frozen at `6196df3`. `app/model.mjs`, its tests, `app/demo-adapter.mjs` and `app/live-adapter.d.ts` are unchanged from `f4c6c42`. No wallet/RPC/policy integration, bank test, signing permission, DNS edit or schedule was added.

Include the new runtime file **`app/presentation.mjs`** in the static app package. It supplies exact integer-unit formatting and display-only status/actor/recovery choices. `app/presentation.test.mjs` adds focused regressions. Existing `data-action` integration hooks remain in use; visible labels changed.

The shared root package and README remain owned by integration. The earlier handoff’s root script additions still apply. Start locally with `node scripts/serve-app.mjs`; run app checks with `node --test app/*.test.mjs`.

## Changes

- Preserve cream/orange/green Manrope branding; supporting product text has a 12px floor, clearer focus rings, field-specific error messages, an error border plus text, and mobile touch targets. Invalid seller input is corrected before a wallet prompt opens, with focus on the field to fix.
- Compact the mobile header and five-step tracker. Keep the current step readable and retain accessible step labels. Put amount held and next actor near the top of a trade.
- Derive the seller headline and activity chips from actual verification/recovery state. A verified order says ready to release; pending recovery identifies the next approving wallet. Pending seller approval is the first seller action panel.
- Keep precise token amounts through offer, quote, wallet, approval, split and receipt. `5.511` USDC / EUR `5.01` stays exact; an equal split is `2.7555` USDC each. Formatting uses integer/BigInt units and supports decimal strings beyond JS’s safe-number range. Rates are not truncated to two decimals.
- Explain before escrow lock that funds remain held until accepted payment verification or a recovery approved by both wallets. Use “Confirm escrow lock” and a deadline explicitly labeled with the Lisbon timezone. Confirmation does not extend that deadline.
- A pending recovery proposal retains “Verify an existing payment” for a locked Paying order, even if payment has not yet been reported and the deadline has passed. It uses the existing report/check route; reporting remains display state, not evidence.
- An expired Reserved order retains its refund action even with a proposal; Paying never receives that action. Proposals create no payment lock. These are presentation fixes against the existing model guards.
- A reported payment no longer displays fresh “send payment” instructions. Closing its sample review leaves a verification action and “don’t pay again” guidance.
- Native dialog Escape restores focus; re-rendered controls restore a matching focus target or the main flow. A small live region announces meaningful status changes without announcing countdown ticks.
- Apply the supplied positioning copy: “Trade euros for USDC on Stellar,” “A clearer handoff from Revolut payment to USDC release,” and the funded offer → confirmed lock → pay → payment check → release sequence. Explanatory verifier/contract trust details sit behind a disclosure. Pricing is labeled “Demo fee.” No cost, speed, anonymity or guaranteed-resolution claim was added.
- Fresh visitors are guided by “Start the demo by funding Ben’s offer” / “Start as seller.” No new state or feature is introduced.

## Domain and evidence boundary

The document uses `https://pactlane.io/` as its canonical/Open Graph URL, with prototype `noindex, nofollow` metadata. Root owns app routing and the planned `https://proof.pactlane.io` proof surface. No URL was deployed, routed or reachability-verified in this lane; domain metadata is not deployment evidence.

The visible status is “Simulated walkthrough · No live payment or settlement.” The sidebar says Stellar demo. Sample disclosure does not promise unaccepted authenticated credential/disclosure behavior. Existing demo adapter and `connect-src 'none'` boundary remain intact. Current screens are UI evidence, not bank proof or settlement evidence.

## Checks and screenshots

Automated checks for this pass: 21 app tests, including seven new presentation tests; 25 module/inline-script syntax checks; scoped formatting; the unchanged live declaration’s strict TypeScript check; diff/whitespace checks. The frozen model’s fourteen regressions remain included. Final command outcomes and immutable revision are reported in the completion message.

Browser checks performed against the loopback preview:

- Invalid amount and invalid tag each keep the wallet dialog closed and focus the corresponding field with `aria-invalid` and explanatory text.
- Escape from settings returns focus to its trigger; closing a payment review after reporting returns to the flow without a second-payment action.
- Exact `5.511` offer, `2.7555` approvals and `19.2445` remaining seller balance observed through actual demo actions.
- Pending recovery before payment reporting retains existing-payment verification and offers no locked-order refund. The expired-unlocked proposal case is covered with explicit timestamps in focused tests; no browser clock or bank data was changed.
- Standard EUR 20 / 22 USDC trade reaches verified state, matching seller ready-to-release headline/activity, and receipt. A distinct recovery scenario uses the exact fractional amount.
- Mobile lock CTA bottom: **770px at 390×844**, **856px at 320×900**. Payment CTA bottom: **799px at 390×844**, **890px at 320×900**. Both fit the first screen at those tested sizes, without horizontal overflow.
- Keyboard actions, native dialog consent and exact same-allocation approvals were exercised. Browser warning/error logs were inspected. This does not claim a full assistive-technology audit.

New captures are under `docs/ui/screenshots/polish/`: first visit, marketplace, escrow lock, payment, seller verified, receipt, field errors, split approval and seller recovery. Earlier screenshots remain historical for `f4c6c42`. These are separate synthetic scenarios, not one real bank trade; do not splice differing amounts/order references into a claimed continuous settlement recording.

## Handoff

Cherry-pick this scoped follow-up after `f4c6c42`, ensure the new presentation module is packaged, then reconcile any integration adapter edits in `app/app.mjs` without changing the lifecycle or demo boundary. Root/video may capture the stable revision. The local preview is stopped after verification; no remote preview is supplied by this component.
