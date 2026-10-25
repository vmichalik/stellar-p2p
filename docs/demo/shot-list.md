# Pactlane demo: capture and shot list

Companion to the [revised script](revised-demo-script.md). Target: **3:00, silent**, ready for Vijay's dub. Updated after the 25 October 2026, 14:32 UTC public-app audit. The app is live; the revised video's final render verification and artifact handoff remain pending. This document is a capture handoff, not a completed video.

## Capture setup

- Record the accepted UI `572f2b92289f3466e4db2bde4fc6bb739e513f4a`, integrated as `4181b318066ba3f2320c75131fded9d745569fb2`, from frozen published source `1c7f03865be9f0f89c17364c4456bd2e042e8be9`, using its synthetic adapter. Record source commit, build hash and capture date in the eventual video handoff; do not silently capture later unreviewed changes.
- Use the real cream/burnt-orange/Manrope interface and paired-receipt mark. Prefer a consistent desktop viewport, with restrained crops into readable panels. Do not reconstruct a smoother but unavailable product screen.
- Keep **“Synthetic demo · No bank payment or on-chain settlement”** visible throughout every app scene, independent of the app header. Preserve it through zooms and transitions.
- Capture two fresh runs, A and B, using separate local fixture sessions or the app's explicit reset between recordings. A is the normal completion; B is recovery after verification is unavailable. Never reset during an active operation. Do not use an actual wallet extension or bank tab.
- Use 22.00 USDC for €20.00 in both runs. These are illustrative whole-offer terms, not a current FX quote. This amount also makes the 11.00/11.00 recovery allocation exact and readable.
- Track the real generated order reference from each run. Editorial “Trade A” and “Trade B” are story labels; never replace the UI's generated references. Require A and B to differ.
- Cursor movement should show the action taken, with a short hold before and after important confirmations. Avoid rapid scrolling. Hold the receipt, warning and two approval states long enough to read.
- Use captions in the table below. No narration, music, notifications or other audio in the render. Do not capture secret values, private runtime configuration, raw transcripts or private account data.

## Ordered shots

| Shot / time | Real screen and action | Must be visible | Continuity and factual check |
| --- | --- | --- | --- |
| 01 · 0:00–0:15 | Marketplace establishing shot. Introduce Ana as buyer and Ben as seller through short editorial labels. | “After you pay, know what happens next.” “EUR / Revolut → Stellar USDC.” Persistent synthetic label. | Frame a target user situation; do not invent demand statistics, bank integrations or balances beyond the fixture. If no funded offers exist yet, retain that honest initial state. |
| 02 · 0:15–0:22 | Ben's seller workspace. Connect demo wallet if needed, create the 22 USDC offer with example tag `@ben`. | 22.00 USDC; exact €20.00; seller role; sample terms. | No actual wallet extension. The app's demo-wallet review remains visible. |
| 03 · 0:22–0:30 | Review the simulated deposit and fund the offer. Hold funded result. | Deposit amount, funded offer, “Seller funds the agreed offer first.” | Capture the confirmed demo state, not merely a clicked button. Capture order reference A for the continuity record. |
| 04 · 0:30–0:45 | Switch explicitly to Ana. Review funded offer and reserve its whole amount. | Buyer role, €20.00 → 22.00 USDC, same seller and reference A. | No editable partial fill. Do not frame the fixture rate as a live market rate or point to the zero-fee row as a benefit. |
| 05 · 0:45–1:00 | Payment-lock panel, then confirmation and payment instructions. | Before: no payment instructions. After: exact amount, `@ben`, labeled deadline. Caption “Confirm the lock before paying.” | Retain the sentence explaining that after lock, resolution requires accepted proof or both approvals. Do not imply the timer guarantees a unilateral refund. |
| 06 · 1:00–1:07 | Brief neutral card over the payment panel: “Revolut transfer happens outside Pactlane — simulated here.” | Clear simulation label, no pretend bank receipt. | No bank UI needs to be captured or fabricated. Return to order A afterward. |
| 07 · 1:07–1:20 | “I've paid,” disclosure review, consent, start demo verification, sample progress. | Recipient, amount, completed outgoing state, payment ID/time; checkbox and demo action label. | This is a synthetic check. Do not insert a public TLSNotary success screen, real extension prompt or bank screenshot here. |
| 08 · 1:20–1:29 | Matched sample payment → receive → demo receipt. | 22 USDC, €20, same reference A, demo-receipt label. | No invented transaction hash or explorer page. If the details button opens a modal, show it as a modal. |
| 09 · 1:29–1:35 | Ben's completed outcome, with a restrained crop of received EUR/released USDC or actual final equivalent. | Seller outcome reconciles with Ana's receipt. Caption “Both sides reconcile.” | Use actual current state. If the final UI still says “Offer closed,” do not paint over it with a claim the screen does not establish. |
| 10 · 1:35–1:48 | Hard scene break “Separate trade · Verification unavailable.” Show order B's failed check and warning. | Distinct reference B, “Don't pay again,” no USDC released, retry/recovery actions. | Prepare B before capture: reset or separate fixture, fund/reserve/lock, choose unavailable proof in Demo settings, report sample payment and verify. Do not carry A's receipt/balances into B. |
| 11 · 1:48–1:58 | Propose equal split on B; review allocation and approve with Ana's demo wallet. | Ana 11.00 USDC, Ben 11.00 USDC; B reference. | One approval does not move funds. Do not call an unconfirmed proposal a refund. |
| 12 · 1:58–2:05 | Hold pending approval state before switching. | Ana approved, Ben waiting, funds still held. Caption “Same allocation. Two approvals.” | This hold is required; it makes the authorization boundary understandable without narration. |
| 13 · 2:05–2:15 | Switch explicitly to Ben, review B and the same allocation, approve, then confirm the agreement. Hold final allocation. | Both approvals, 11/11 result, trade resolved, zero held. | Ben's view must be explicit. Keep “mutual agreement” distinct from “verified payment”; recovery does not prove EUR receipt. Include “A locked trade can remain unresolved if either party will not agree.” |
| 14 · 2:15–2:42 | Full scene break to sanitized recorded local execution evidence. Use the real report, not a synthetic terminal animation. | Label “Local compiled-WASM test · Synthetic payment evidence · No network transaction”; source `006ab023`; signature checked; buyer 22 USDC/escrow 0; replay rejected. | This is a separate recorded implementation test. It is not a capture of the browser causing a live payout. Keep synthetic payment/actor authorization and absence of network transactions clear. |
| 15 · 2:42–3:00 | Final cream card with current paired-receipt logo. | “Know the terms. Follow the payment. See the release.” Readable supporting line: “Prototype · Live payment verification is still in development.” CTA “Try the Pactlane demo.” and plain `pactlane.io`. | The public app was verified at 14:32 UTC. Keep `NOT_CLEARED` in technical evidence/handoff, not this card. Do not imply the app publication establishes an accepted bank proof or network settlement, and do not add the pending proof endpoint. |

## Evidence-card source

Use the stable integrated report at:

`/Users/vijay/Documents/workspace-personal-projects/pactlane-integration/evidence/release/local-wasm-rehearsal.json`

Recorded source revision: `006ab023e4d44600d03f320f220457e5b5545f0e`. Observed: `2026-10-25T13:45:02.466Z`. Inspected in integration snapshot `c8f44752b82b1fe8f766028a782e7759caef2cc7`.

It records compiled Soroban WASM in a local host, a verified policy signature, buyer 220,000,000 token atoms, escrow zero and rejected replay. It also records synthetic payment evidence, `NOT_CLEARED`, no submitted network transactions and a null transaction hash. Preserve these limitations when selecting the visible fields. The integration harness mocks actor authorization for synthetic wallets; separate contract suites cover actor authorization.

Do not rerun a test solely to create a more impressive-looking terminal. The existing sanitized record is adequate for this cut. If a fresh run is needed after a code change, its owner must record the new source, result and limitations before the shot is updated.

## Public demo evidence

The app at [pactlane.io](https://pactlane.io) was published at 14:30 UTC as Worker version `3ae4a684-a01f-43f7-b092-8d462ac3d87f`, from source `1c7f03865be9f0f89c17364c4456bd2e042e8be9`. An independent unauthenticated HTTP audit at `2026-10-25T14:32:34.804925+00:00` passed all 53 checks, including frozen manifest/asset hashes and `www`/`app` 308 redirects preserving path and query. [Sanitized audit](../../evidence/release/public-domain-2026-10-25.json). The Worker version comes from the coordinator's deployment handoff, not an HTTP-exposed version value.

This permits the live demo CTA. It does not change the original local-WASM observation date, establish a bank payment or turn the synthetic browser receipt into a network transaction. Final integration acceptance reports 202 JS and 8 Python tests; the earlier 29 native/29 compiled-WASM contract cases remain pinned to unchanged contract bytes.

## Final review before delivery

1. Duration is 3:00 and the audio track is absent or silent. Vijay can record his own dub without competing sound.
2. All app shots retain the exact synthetic label. The local-WASM shot uses its separate label. Both remain readable at normal playback size.
3. Trade A's reference and amounts remain consistent through normal completion. Trade B has a distinct reference, and no completed trade is reopened for recovery.
4. Payment instructions appear only after the lock. An unavailable check retains escrow and says not to pay again. One recovery approval moves nothing; both approve the same allocation before confirmation.
5. No screenshot, callback, demo receipt, public proof or setup benchmark is presented as accepted bank-payment evidence. No network transaction or explorer hash is invented.
6. Captions do not claim guaranteed release, no disputes, instant settlement, zero fees, lower pricing, complete privacy or validated demand. The policy operator and unresolved bank gate remain clear.
7. Use “Try the Pactlane demo.” and plain `pactlane.io`, supported by the 14:32 UTC public audit. Retain the readable prototype/live-verification limitation. `proof.pactlane.io` stays out of the general CTA while DNS/certificate readiness is pending and the owner cannot log in.
8. Compare the final product screenshots with the approved app commit, then record source/build/capture identities and remaining gaps in the video owner's handoff. This document itself is not a completed video or live verification result.

## Authoring handoff

Created on the Mac mini as a new file in canonical `stellar-p2p`, branch `main`, baseline `807412686da2cdad494ee284675dbefc35110257`. Existing changes in that checkout were preserved. Active app/integration and video artifact sources were not edited. No render, live request, bank test, deployment, commit or submission was performed.

Next: finish the silent cut from the accepted final app snapshot and specified synthetic states. Final render verification and artifact handoff remain pending; root will append the accepted artifact details separately. The research-backed opening and verified demo CTA are incorporated; demand and commercial friction remain unvalidated.
