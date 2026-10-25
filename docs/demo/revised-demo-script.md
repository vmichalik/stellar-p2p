# Pactlane: concept-led three-minute demo

Published and publicly verified on 25 October 2026 at 15:44 UTC: [app](https://pactlane.io), [silent video](https://pactlane.io/demo.mp4) and [dub script](https://pactlane.io/demo-script.txt). Frozen integration source `88ba889f1927ec9283b45c2120d9c8df6a661419`; Worker `e95529b6-f423-483e-a19c-f95c44e43508`. The [public audit](../../evidence/release/public-narrative-2026-10-25.json) passed all 67 required checks (67/68 overall). The existing range limitation remains: requests return the complete verified MP4 instead of HTTP 206. Chrome playback confirms 180 seconds, 1920×1080 and no media error. This remains a synthetic demonstration.

A 3:00 silent video for Vijay’s own dub. No generated narration, music or sound effects. Canonical rationale: [concept](../concept.md) and [positioning](../positioning.md). Exact capture timings: [shot list](shot-list.md).

## Why this cut exists

Someone must already need USDC on Stellar, for example to fund a specific app or pay a recipient who uses that asset and network. The opening then presents a personal preference: use an existing payment account, avoid another exchange account and another institution holding identity documents, and compensate the person supplying USDC. These are motivations to test, not validated demand, a no-KYC commitment, a privacy guarantee or proof of lower cost. Existing exchanges and wallet on-ramps remain real alternatives, discussed in the concept.

Ben supplies USDC and wants euros. His potential margin is in the offered price; it is not a separate fee automatically redistributed to peers. The €20.00/22.00 USDC fixture does not calculate profit or establish a live rate.

Once someone chooses a direct trade, the escrow/payment-check sequence explains how it could work. The normal demonstration is seller funding → whole-offer reservation → confirmed lock → payment instructions → sample consent/payment check → policy-authorized release → simulated receipt. A separate order shows unavailable verification and two-wallet recovery. The local compiled-WASM record is separate implementation evidence.

## Exact public narration

The rendered video remains silent. Read the following copy against its timed picture; it is also supplied as plain `DUB_SCRIPT.txt`.

PACTLANE — WHY I’M BUILDING IT
180 seconds. Silent video; record your own voiceover. All app screens use the synthetic demo adapter.

00:00–00:25
If I need USDC for a Stellar app or payment, I don’t want another exchange account or another company holding my passport. I’d rather use the payment account I have and pay the person supplying the USDC. That’s why I’m building Pactlane. This walkthrough uses sample payments.

00:25–00:40
Ben creates a whole offer: twenty-two USDC for twenty euros. These are illustrative terms. A seller can include a margin in their price; that doesn’t mean this route is cheaper. Ben reviews the deposit and funds the offer first.

00:40–00:55
Ana reviews the same terms and reserves the entire offer. Both sides follow the same trade reference. The next action is explicit: confirm the payment lock. Payment instructions stay hidden until that lock confirms.

00:55–01:10
After locking, USDC stays held until payment is accepted or both wallets approve recovery. The timer is a payment window, not a refund timer. An on-time payment can still be verified later.

01:10–01:30
The Revolut transfer happens outside Pactlane. This demo uses sample payment data. Ana reviews the details requested for this check. The privacy goal still needs proving. The payment policy signs release authorization, and the contract checks that signature. Live bank verification is still unfinished.

01:30–01:45
The sample payment matches, and Ana receives a demo receipt for twenty-two USDC. Ben’s view reconciles with hers. This demonstrates the product flow. It is not a bank proof or a Stellar network transaction.

01:45–01:58
Now a separate trade. Verification is unavailable. The app says not to pay again, and no USDC is released. The buyer can retry the check or propose an agreement with the seller.

01:58–02:25
For this recovery example, Ana proposes eleven USDC to each participant. She reviews and approves that exact allocation. Her approval alone moves nothing. Ben reviews the same trade and amounts, then approves. Both approvals allow the agreement to be confirmed. This is mutual recovery; a locked trade can remain unresolved if either person will not cooperate.

02:25–02:42
Separately, the payment policy and compiled Soroban contract ran together locally. The contract checked the policy signature, released once, and rejected replay. This uses synthetic payment evidence and local tokens. Actor authorization is mocked here. No network transaction was submitted.

02:42–03:00
That’s the prototype: a funded direct trade, with a payment check before release. Reliable live verification is still the next hurdle, followed by a confirmed testnet trade. You can try the demo at pactlane dot io.

Silent video. No audio has been generated or added.

## Visual and claim boundaries

- Every app scene retains “Synthetic demo · No bank payment or on-chain settlement,” including crops and pointer actions. Intro/outro use “Prototype demonstration · No live payment or settlement.”
- The implementation segment uses “Local compiled-WASM test · Synthetic payment evidence · No network transaction.” It is not intercut as if the browser caused a live payout.
- The intended privacy benefit remains unproven. Revolut knows the payment, the counterparty receives payment information, and Stellar settlement is public. Production onboarding, disclosure and retention require further work.
- Payment instructions appear only after confirmed lock. An on-time payment can be verified later. The payment window does not create a unilateral refund.
- Order A completes normally; distinct order B demonstrates unavailable verification. One recovery approval moves nothing; both wallets approve the exact allocation before confirmation. An uncooperative party can leave funds unresolved.
- The payment policy signs release authorization; the contract checks that signature. The contract does not directly read or authenticate a bank transcript.
- No real bank account, wallet extension, private runtime origin, raw transcript, fake explorer page or invented transaction hash appears. Switching Ana/Ben demonstrates a local fixture’s roles, not multiuser authentication.
- The final card says “Buy USDC from another person.” It invites viewers to pactlane.io and clearly states “Prototype · Live payment verification is still in development.”

## Source and implementation evidence

Frozen app source: `5bd17fde42340d898435eaecd873ba25366c32ee`. Capture identity and all image hashes: `capture-concept.json`. Actual generated references: A `PL-3EEB4639`; B `PL-2349196A`.

Recorded local-WASM evidence is unchanged: source `006ab023e4d44600d03f320f220457e5b5545f0e`, observed `2026-10-25T13:45:02.466Z`. The payment-policy signature was checked by the compiled escrow, the buyer received 220,000,000 atoms (22.00 USDC), escrow reached zero, and replay was rejected. Payment evidence, tokens and wallets were synthetic/local. Actor authorization was mocked in this integration harness; separate contract tests cover it. No network transaction was submitted; the transaction hash is null and the live-payment gate remains `NOT_CLEARED`. A newer app capture or video render does not refresh this evidence date.

The new app and video are publicly verified in the release recorded above. The Worker version is deployment-handoff metadata; public HTTP checks independently match the frozen manifest and asset hashes. `proof.pactlane.io` is not a general-demo CTA and is not represented as a usable authenticated bank-proof endpoint.

## Final handoff

Final MP4: `renders/concept-v2/pactlane-three-minute-concept-silent.mp4` (4,764,952 bytes). SHA-256: `49f8ec2b46b35981bcee0398ed0206dcafa5131e20afa24be608a8eba2129436`. Verified 1920×1080, 30fps, exactly 180 seconds/5400 frames, zero audio streams, successful full decode and no black frames. All 24 decoded scene midpoints, ending and cursor were visually reviewed. Final strict source checks are recorded in `renders/concept-v2/check.json`. Public narration: `DUB_SCRIPT.txt`. Video handoff: `HANDOFF-CONCEPT.md`.

Execution host: continuity Mac mini. Authoring directory: `/Users/vijay/.codex/visualizations/2026/10/25/01a17312-30fa-7cf1-82b9-3a0e22e07351/pactlane-demo-revised`. Canonical documentation: `/Users/vijay/Documents/workspace-personal-projects/stellar-p2p`, branch `main`, base `807412686da2cdad494ee284675dbefc35110257`; unrelated local changes are preserved. This pass edits only these two assigned demo docs in canonical and the isolated video project. It does not commit, deploy, publish, submit a payment, install packages or alter global skills. The prior MP4 remains untouched; prior editable source/script/captures are preserved in `renders/source-before-concept.tar.gz`.

Coordinator publication and public checks are complete. The remaining product milestone is accepted live payment evidence and a confirmed testnet trade, when owner-dependent testing resumes. No bank action was performed for this release.
