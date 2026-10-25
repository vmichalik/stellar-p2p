# Pactlane: revised three-minute demo

Copy status: final app and public-domain status reconciled on 25 October 2026 after the 14:32 UTC audit, with the research owner's final positioning incorporated. The opening frames a documented kind of P2P coordination problem; it is not a validated demand, prevalence or market-size claim. The synthetic app is published and independently HTTP-verified at [pactlane.io](https://pactlane.io). The revised silent video's final render verification and artifact handoff remain pending.

Deliverable: a 3:00 silent screen demo, with concise on-screen copy and room for Vijay to dub it. Do not add generated narration, music or sound effects. Use real app captures and the existing cream, burnt-orange and Manrope design. The companion [shot list](shot-list.md) gives capture states and continuity checks.

## The story

Ana already has a Stellar wallet and uses Revolut. Ben wants to exchange some USDC for EUR. Sending euros and receiving crypto are separate steps. If confirmation stalls, the trade can turn into messages, receipts and a support case. A buyer-supplied screenshot does not authenticate a bank payment, and asking the seller to interpret it and release tokens adds a manual decision. Pactlane's intended normal path checks authenticated payment evidence against agreed terms before a signed authorization can release escrow.

This problem exists in established P2P workflows: OKX documents payments followed by missing crypto release, counterparty reminders, support escalation and image/video evidence. That supports the scenario, not a claim about how often it happens or demand for Pactlane. [Official OKX dispute guidance](https://www.okx.com/en-us/help/how-do-i-raise-a-dispute-when-using-p2p-trading), checked 25 October 2026.

The initial audience remains a hypothesis: existing Stellar-wallet users with EUR/Revolut who are considering P2P exchange. Extension setup, proof reliability, available counterparties and two-party recovery may add friction. The demo should let a viewer judge the proposed handoff; it must not claim the commercial tradeoff is already solved.

The demo shows the built user flow with synthetic data. A separate evidence card shows actual local contract execution. An accepted authenticated Revolut transfer and an on-chain settlement remain unproven; do not splice public-proof success into the payment flow as if they are the same result.

Keep this exact label visible on every app scene, including cropped close-ups:

> Synthetic demo · No bank payment or on-chain settlement

The local evidence card uses its own exact label:

> Local compiled-WASM test · Synthetic payment evidence · No network transaction

## Timed script

The dub column is optional spoken copy for Vijay. The final render stays silent. Screen text should remain readable without the dub; show only the current scene's caption, not this whole table.

| Time | Picture and on-screen copy | Optional dub |
| --- | --- | --- |
| 0:00–0:15 | Start in the real Pactlane marketplace, then reveal Ana/Ben as buyer/seller. Caption: **“After you pay, know what happens next.”** Small context: “EUR / Revolut → Stellar USDC.” | “In a manual P2P trade, sending euros and receiving crypto are two separate steps. If confirmation stalls, the trade can turn into messages, receipts and a support case.” |
| 0:15–0:30 | Ben's seller workspace: 22 USDC, exactly €20, create offer, review demo deposit, fund. Caption: **“Seller funds the agreed offer first.”** Keep the simulation label visible. | “Pactlane starts with a funded offer. In this simulated trade, Ben offers twenty-two USDC for exactly twenty euros. The amount is fixed for the whole offer; this rate is an example, not a market quote.” |
| 0:30–0:45 | Switch explicitly to Ana. Select Ben's funded offer, review exact amounts, reserve. Hold the trade reference. Caption: **“Buyer reserves the same terms.”** | “Ana can see what she will pay and what she will receive. She reserves that offer, and both sides follow the same trade reference.” |
| 0:45–1:00 | Show lock screen before payment instructions. Confirm lock, then reveal payment amount, recipient and deadline. Caption: **“Confirm the lock before paying.”** Second line: “After lock: verified payment or agreement by both wallets.” | “Payment instructions appear only after the payment lock confirms. After that, funds stay held until a valid payment check authorizes release, or both wallets approve a resolution. The lock is a commitment, not an automatic refund timer.” |
| 1:00–1:20 | Hold payment instructions; use a neutral editorial card, **“Revolut transfer happens outside Pactlane — simulated here.”** Return to “I've paid,” then the sample disclosure review, checked consent and simulated progress. Caption: **“Match selected payment details to this trade.”** | “The intended next step is the Revolut transfer, outside Pactlane. Here, payment data is simulated. Ana reviews the recipient, amount, outgoing completion status, payment identity and time. The intended connected flow must authenticate that evidence before the policy can accept it.” |
| 1:20–1:35 | Show matched sample payment, receive action, simulated receipt, then Ben's matching outcome. Caption: **“One completed demo trade. Both sides reconcile.”** | “The sample payment matches, and Ana receives a demo receipt for twenty-two USDC. Ben's view agrees. This browser receipt demonstrates the product flow; it is not a bank proof or a Stellar transaction receipt.” |
| 1:35–1:48 | Clear scene break: **“Separate trade · Verification unavailable.”** Show a distinct order B, its failed verification, “Don't pay again” and held funds. Caption: **“A failed check does not release escrow.”** | “Now a separate trade. The payment check cannot finish. The app says not to pay again, and the USDC remains held. The buyer can retry verification or propose an agreement.” |
| 1:48–2:15 | Order B only: propose equal split, review Ana's exact 11/11 allocation, approve once and hold on Ben waiting. Switch to Ben explicitly; review the same order/allocation, approve and confirm. Show resolved outcome and zero held. Caption: **“Same allocation. Two approvals.”** Then: “Agreement demonstrated: 11 USDC each.” | “For this recovery example, both participants agree to split the twenty-two demo USDC equally. Ana's approval alone moves nothing. Ben reviews the same allocation before approving. Only then is the agreement confirmed. This is mutual recovery, not automatic dispute resolution; an uncooperative party can leave a locked trade unresolved.” |
| 2:15–2:42 | Leave the browser demo. Show the actual sanitized local-WASM rehearsal record with source revision and the local-test label. Highlight signature checked, buyer 22/escrow 0, replay rejected. Caption: **“Implemented and exercised locally.”** Second line: “Policy signature → compiled escrow → one release.” | “Separately, the implemented policy and compiled Soroban contract have run together locally with synthetic payment evidence. The contract checked the real policy signature, released once, and rejected replay. That is execution evidence for the implementation, with a local token and synthetic wallets. No network transaction was submitted.” |
| 2:42–3:00 | Final cream card with Pactlane paired-receipt mark. **“Know the terms. Follow the payment. See the release.”** Readable supporting line: **“Prototype · Live payment verification is still in development.”** CTA: **“Try the Pactlane demo.”** Footer, plain text: **“pactlane.io”**. | “Pactlane makes the terms, payment check and next action clear to both people. Our next milestone is an accepted authenticated Revolut payment, followed by a confirmed testnet trade. Try the demo at pactlane dot io. Know the terms. Follow the payment. See the release.” |

## Copy decisions

- Lead with coordination and payment authenticity for an existing Revolut/Stellar user. Do not describe an acquisition funnel, broad consumer need or demand level as validated.
- Keep fee comparisons, speed claims and privacy promises out of this cut. The example exchange rate and demo fee row do not establish actual pricing or savings.
- “Payment verification” describes a sample app state in the screen demo. “Authenticated payment evidence” describes the intended bank integration until its gate is cleared.
- Say “release after an accepted payment check” for the intended normal path. Do not say “guaranteed release,” “no disputes,” “trustless,” “instant,” or “no manual work.” A configured policy operator remains part of the trust model; recovery needs both wallets.
- Do not show a real Revolut account, transaction, receipt, extension authorization, private verifier origin or bank log. A plain “simulated here” transfer card is enough.
- Do not use the successful trade A receipt as the setup for recovery. Trade B is a different generated order, captured in a fresh synthetic run.
- The current UI is a local shared fixture for two fictional participants. Switching Ana/Ben demonstrates roles, not multiuser authentication or cross-device state synchronization.

## Approved copy for app and demo alignment

These are ready-to-use strings for the app owner to reconcile with the final interface. This document does not implement those app changes.

| Placement | Copy |
| --- | --- |
| Product heading | Trade euros for USDC on Stellar. |
| Supporting line | A clearer handoff from Revolut payment to USDC release. |
| Problem caption | After you pay, know what happens next. |
| Seller explanation | Fund the agreed offer. Follow the payment check before USDC is released. |
| Sample-proof framing | Review the selected details for this demo payment check. |
| Recovery explanation | If the check cannot finish, funds stay held. Retry verification or agree on a resolution with the other participant. |

Use the exact synthetic label alongside these strings. Do not add “first on Stellar,” price leadership, speed or broad privacy claims to strengthen the pitch.

## Implementation evidence and the live gap

The recording should cite the following stable candidate evidence separately from the app simulation. These files live in the integration worktree and are not presumed present on canonical `main`.

| Claim permitted in this cut | Evidence and limitation |
| --- | --- |
| The app models seller funding, exact reservation, confirmed lock before instructions, sample proof, receipt and two-wallet recovery. | Final UI `572f2b92289f3466e4db2bde4fc6bb739e513f4a`, integrated as `4181b318066ba3f2320c75131fded9d745569fb2`; frozen published integration source `1c7f03865be9f0f89c17364c4456bd2e042e8be9`. It includes the final responsive/copy polish and recovery presentation corrections. The running adapter is synthetic; no bank, wallet or chain connection. |
| Actual policy signature verification and one token release passed in the compiled escrow locally. | Integration `evidence/release/local-wasm-rehearsal.json`, recorded 2026-10-25 at 13:45:02 UTC, source revision `006ab023e4d44600d03f320f220457e5b5545f0e`. `signatureCheckedByWasm: true`; buyer `220000000` atoms; escrow `0`. Payment evidence and actor wallets are synthetic; authorization is mocked in this integration harness. Separate escrow tests cover wrong/missing actor authorization. |
| Replay was rejected locally. | The same recorded run has `contractReplayRejected`, `policyReplayRejected` and `duplicateUiSettlementRejected` set to true. Do not present this as a live production incident test. |
| An accepted bank payment and a network settlement are still missing. | The same report records `livePaymentGate: NOT_CLEARED`, `networkTransactionsSubmitted: false`, `transactionHash: null`. Public HTTP proof success is a separate observation and does not fill this gap. |

The local-WASM report was inspected in the earlier integration snapshot `c8f44752b82b1fe8f766028a782e7759caef2cc7`; its source and 13:45 UTC observation remain unchanged. The published app uses frozen source `1c7f03865be9f0f89c17364c4456bd2e042e8be9`. Final integration checks report 202 JS and 8 Python tests passed; the earlier 29 native/29 compiled-WASM contract results remain tied to unchanged contract bytes. Do not refresh the historical WASM evidence date or expand its claims because the UI and public hosting are newer.

## Domain treatment

Use **“Try the Pactlane demo.”** and plain **“pactlane.io”** on the closing card. The coordinator published Worker version `3ae4a684-a01f-43f7-b092-8d462ac3d87f` at 14:30 UTC from frozen source `1c7f03865be9f0f89c17364c4456bd2e042e8be9`. The independent unauthenticated audit at 14:32 UTC passed all 53 checks, including public manifest/assets and `www`/`app` 308 redirects preserving path and query. See [sanitized public-domain evidence](../../evidence/release/public-domain-2026-10-25.json). The Worker version is deployment-handoff metadata, not independently exposed by HTTP.

Keep **“Prototype · Live payment verification is still in development.”** readable on the closing card. `NOT_CLEARED` belongs in the technical evidence and handoff, not the user-facing closing message. A working public app URL does not establish accepted bank evidence or live settlement.

`proof.pactlane.io` is an optional technical route pending DNS and service verification. It is not a second CTA for this general demo. Do not display it as a working proof endpoint or invite a bank action. Proof DNS readiness does not establish an accepted payment proof.

## Handoff

Authoring host: Mac mini. Destination: `/Users/vijay/Documents/workspace-personal-projects/stellar-p2p`, branch `main`, baseline `807412686da2cdad494ee284675dbefc35110257`. This is a new coordinator-owned document, not a change to active app or video sources. Existing main changes are preserved. No recording, render, bank test, network transaction, publication or commit is performed by this handoff.

Next action: finish the revised silent video against the accepted app snapshot, retaining the two distinct synthetic runs and separate local evidence card. Final render verification and artifact handoff remain pending; root will append artifact details after acceptance. Research positioning and the verified live demo CTA are incorporated. A change to the live-payment gap requires fresh evidence.
