# Pactlane demo: final shot and capture list

Published and publicly verified on 25 October 2026 at 15:44 UTC: [app](https://pactlane.io), [silent video](https://pactlane.io/demo.mp4) and [dub script](https://pactlane.io/demo-script.txt). Frozen integration source `88ba889f1927ec9283b45c2120d9c8df6a661419`; Worker `e95529b6-f423-483e-a19c-f95c44e43508`. The [public audit](../../evidence/release/public-narrative-2026-10-25.json) passed all 67 required checks (67/68 overall). The existing range limitation remains: requests return the complete verified MP4 instead of HTTP 206. Chrome playback confirms 180 seconds, 1920×1080 and no media error. This remains a synthetic demonstration.

Target: **3:00, 1920×1080, 30fps, no audio track**. Companion to the [concept-led narration](revised-demo-script.md). The video uses the cream/burnt-orange/Manrope app with restrained crops and legible editorial text.

## Capture identity

Frozen app source: `5bd17fde42340d898435eaecd873ba25366c32ee`. Capture identity and all image hashes: `capture-concept.json`. Actual generated references: A `PL-3EEB4639`; B `PL-2349196A`.

Capture the immutable source via actual UI actions in the synthetic adapter, using the actual default 1200×829 desktop viewport through CUA. Full viewport JPEG pixels are preserved at 1185×819 and framed only in the composition; magnification is capped at 2×. No real bank, wallet extension or chain action. Wait for transient toasts to disappear before each image. Preserve generated order references; never paint over UI text.

The first run funds, reserves, locks, verifies a sample payment and completes. Explicitly reset the fixture before the second run, which funds, reserves and locks a fresh order, sets the simulated proof result to unavailable, and demonstrates the 11.00/11.00 allocation with both approvals. Never reopen the completed first order for recovery.

## Timed shots

| Shot / time | Source | Main caption | Supporting context |
| --- | --- | --- | --- |
| 01 · 0:00–0:10 | Editorial motive card | I already have a bank account. | A personal reason to build. The privacy benefit still needs proving. |
| 02 · 0:10–0:19 | Editorial peer card | I’d rather pay the person supplying the USDC. | A seller’s margin can sit in the offered rate. Lower total cost is not established. |
| 03 · 0:19–0:25 | Actual app capture `00-why` | Trade euros for USDC on Stellar. | Pay someone through Revolut. Receive USDC in your Stellar wallet. |
| 04 · 0:25–0:32 | Actual app capture `02-create` | Ben sets the whole offer. | Illustrative terms: €20.00 for 22.00 USDC |
| 05 · 0:32–0:36 | Actual app capture `03-deposit` | The seller funds the agreed offer first. | Review the exact deposit before approving. |
| 06 · 0:36–0:40 | Actual app capture `04-funded` | The offer is funded. | 22.00 demo USDC held for this offer. |
| 07 · 0:40–0:46 | Actual app capture `05-reserve` | Ana reviews the same terms. | You pay €20.00. You receive 22.00 USDC. |
| 08 · 0:46–0:55 | Actual app capture `06-lock` | The whole offer is reserved. | Payment details stay hidden until the lock confirms. |
| 09 · 0:55–1:03 | Actual app capture `06-lock` | Confirm the lock before paying. | After locking: accepted payment or agreement by both wallets. |
| 10 · 1:03–1:10 | Actual app capture `07-payment` | Lock confirmed. Payment instructions appear. | The payment deadline is not an automatic refund timer. |
| 11 · 1:10–1:17 | Editorial transfer card | The Revolut transfer happens outside Pactlane. | Simulated here. No bank account or payment is shown. |
| 12 · 1:17–1:21 | Actual app capture `08-fields` | Review the selected payment details. | Sample data in this demo. A connected flow must authenticate it. |
| 13 · 1:21–1:26 | Actual app capture `08-consent` | Know what the payment check would disclose. | The privacy goal still needs proving. This demo shares no bank data. |
| 14 · 1:26–1:30 | Actual app capture `09-matched` | The sample payment matches this trade. | The payment policy signs release authorization. The contract checks that signature. |
| 15 · 1:30–1:39 | Actual app capture `10-receipt` | One completed demo trade. | A demo receipt, with no bank proof or network transaction. |
| 16 · 1:39–1:45 | Actual app capture `11-seller` | Both sides see the same outcome. | The seller’s demo balances reconcile with Ana’s receipt. |
| 17 · 1:45–1:58 | Actual app capture `12-failure` | Separate trade. Verification unavailable. | Don’t pay again. No USDC has been released. |
| 18 · 1:58–2:05 | Actual app capture `13-propose` | Agree how to resolve the held funds. | This example proposes 11.00 USDC to each participant. |
| 19 · 2:05–2:12 | Actual app capture `14-ana-approval` | Ana reviews and approves the allocation. | Approval is for this trade and these exact amounts. |
| 20 · 2:12–2:17 | Actual app capture `15-pending` | One approval moves nothing. | Funds stay held. Ben’s approval is still needed. |
| 21 · 2:17–2:22 | Actual app capture `16-ben-approval` | Ben reviews the same allocation. | Two wallets approve one agreement. |
| 22 · 2:22–2:25 | Actual app capture `17-resolved` | The agreed allocation is confirmed. | Mutual recovery is not verification of the EUR payment. |
| 23 · 2:25–2:42 | Separate recorded local-WASM evidence | Implemented and exercised locally. | Synthetic payment evidence · No network transaction |
| 24 · 2:42–3:00 | Editorial closing card | Buy USDC from another person. | Prototype · Live payment verification is still in development. |

## Required continuity

1. €20.00 buys the entire 22.00 USDC fixture offer. The terms are illustrative. Seller margin can be in the offered rate; no profit or savings is inferred.
2. Funding precedes reservation. Payment instructions follow the confirmed lock, and an unavailable proof leaves funds held with “Don’t pay again.”
3. A and B use distinct generated references. Both sides of each trade see matching amounts and participants.
4. Ana’s approval alone cannot confirm recovery. Ben reviews the same allocation, then the UI confirms agreement and shows the final exact allocation.
5. All app scenes retain “Synthetic demo · No bank payment or on-chain settlement.” The implementation segment uses its separate local-WASM label. No scene claims anonymity, no KYC, zero fees, cheaper prices, guaranteed release or no disputes.
6. Cursor actions land on the actual control in the captured image. Pointer and final CTA are checked again in decoded video.

## Historical evidence

Recorded local-WASM evidence is unchanged: source `006ab023e4d44600d03f320f220457e5b5545f0e`, observed `2026-10-25T13:45:02.466Z`. The payment-policy signature was checked by the compiled escrow, the buyer received 220,000,000 atoms (22.00 USDC), escrow reached zero, and replay was rejected. Payment evidence, tokens and wallets were synthetic/local. Actor authorization was mocked in this integration harness; separate contract tests cover it. No network transaction was submitted; the transaction hash is null and the live-payment gate remains `NOT_CLEARED`. A newer app capture or video render does not refresh this evidence date.

Sanitized source file: `source/local-wasm-rehearsal.json` in the video artifact, copied from the integration evidence record. Preserve its source and observation timestamp even though the app capture is newer.

## Output and handoff

Final MP4: `renders/concept-v2/pactlane-three-minute-concept-silent.mp4` (4,764,952 bytes). SHA-256: `49f8ec2b46b35981bcee0398ed0206dcafa5131e20afa24be608a8eba2129436`. Verified 1920×1080, 30fps, exactly 180 seconds/5400 frames, zero audio streams, successful full decode and no black frames. All 24 decoded scene midpoints, ending and cursor were visually reviewed. Final strict source checks are recorded in `renders/concept-v2/check.json`. Public narration: `DUB_SCRIPT.txt`. Video handoff: `HANDOFF-CONCEPT.md`.

Execution host: continuity Mac mini. Authoring directory: `/Users/vijay/.codex/visualizations/2026/10/25/01a17312-30fa-7cf1-82b9-3a0e22e07351/pactlane-demo-revised`. Canonical documentation: `/Users/vijay/Documents/workspace-personal-projects/stellar-p2p`, branch `main`, base `807412686da2cdad494ee284675dbefc35110257`; unrelated local changes are preserved. This pass edits only these two assigned demo docs in canonical and the isolated video project. It does not commit, deploy, publish, submit a payment, install packages or alter global skills. The prior MP4 remains untouched; prior editable source/script/captures are preserved in `renders/source-before-concept.tar.gz`.

Coordinator publication is complete, as recorded at the top of this document. Public HTTP checks match this new revision and media; historical evidence and previous media remain preserved.
