# Mobile navigation and desktop verification handoff

Objective: floating mobile navigation and an understandable phone-to-desktop TLSNotary setup path. Implemented on the Mac mini, 25 October 2026, in `/Users/vijay/Documents/workspace-personal-projects/pactlane-ui`, branch `codex/pactlane-ui`, on top of `572f2b92289f3466e4db2bde4fc6bb739e513f4a`. The completion message supplies the resulting immutable commit. No push, publication, proof runtime change or bank test was performed.

## Implemented

- At 760px and below, the existing single navigation becomes a floating bottom bar with three 56px targets, visible labels, active-page state, safe-area placement and scroll clearance. Toasts sit above it. Native modal dialogs cover it and retain focus trapping. Desktop keeps its sidebar. The mobile trade back link is replaced by the persistent My trades control.
- Before reservation and before escrow locking, explain that live verification needs desktop Chrome and TLSNotary. The payment screen and selected-payment review link to the same concise setup guide.
- The guide links directly to the [official TLSNotary listing](https://chromewebstore.google.com/detail/tlsnotary/gnoglgpcamodhflknhmafmjdahcejcgg), outlines installation, matching the same buyer wallet/trade, selecting the existing completed Revolut transfer, reviewing disclosure and returning to the trade. It says not to pay again. The installed-extension version must be rechecked at live integration; the listing and prototype preparation both identify `0.1.0.1501` at this review. The [upstream quickstart](https://tlsnotary.org/docs/quick_start/browser_extension/) supplies the supported installation route.
- Copy a desktop checklist, including the current sample trade reference and exact quote when opened from a trade. No wallet keys, bank authentication, payment IDs or serialized trade authority go into it. A selectable textarea supports manual copying when clipboard access fails. Recipient tags remain hidden before confirmed locking.
- Keep copy and return actions visible in the scrolling guide on small phones. Returning to payment review resets consent to unchecked; installation/checklist actions never mark payment verified.
- Explain the selected fields' intended recipient (Pactlane's verifier) and public Stellar settlement in payment review. The preview sends no bank data.

## Actual limit and next integration work

**This is a setup guide and checklist, not an implemented cross-device resume protocol.** The app explicitly says demo trades remain in their original browser. It offers no fake resume token, QR code, verified-extension indicator or live proof launch. A user can finish the entire synthetic walkthrough on mobile without an extension.

A working live handoff still needs an authoritative order read after reconnecting the same buyer wallet, a supported verifier origin and extension readiness check, order-bound proof/policy acceptance, return/result reconciliation and wallet-confirmed release. A link or browser callback cannot authorize release. Continue to hide payment instructions until the confirmed lock; retain late existing-payment verification and two-wallet recovery. The unverified `proof.pactlane.io` route was not introduced into this UI.

`app/model.mjs`, `app/demo-adapter.mjs`, `app/presentation.mjs`, live declarations and tests remain unchanged. No extra dependency or external request path was added. The local preview keeps `connect-src 'none'`.

## Checks performed

- All 21 existing app tests pass; syntax checks pass for 25 modules/inline scripts. Scoped Prettier and `git diff --check` pass.
- Browser: all three navigation destinations and active states; native dialog focus/escape and navigation blocked under the modal; checklist success message and readable exact text; guide-to-payment-review return with unchecked consent and disabled start action.
- One complete sample seller funding → buyer reservation → confirmed lock → payment review → verification → receipt was repeated. No recipient-copy control before locking. No bank connection was used.
- 390×844 and 320×900 trade layouts; 320×700 guide; 1280×900 desktop. No horizontal overflow in the checked views. At 320×900 the payment CTA ends at 800px and the bar begins at 818px. All navigation targets are 56px tall. Desktop navigation remains static inside the sidebar. No warning/error console entries observed.
- Local preview stopped after review. Loopback QA is not a remote preview or deployment check. Safe-area CSS is present; no physical iPhone/Android or assistive-technology certification is claimed.

## Changed shots for integration/video

New screenshots in `screenshots/mobile-navigation/`: `trades-phone.jpg`, `receipt-phone.jpg`, `desktop-guide-phone.jpg`, `desktop-guide-computer.jpg`, `payment-review-phone.jpg`, `marketplace-desktop.jpg`.

Recapture mobile scenes containing the header/navigation; quote/lock preflight; payment/help; selected-payment review. The desktop shell is retained. The guide is a planned live-setup explanation and must not be cut into the synthetic demo as proof of a real bank handoff. Historical screenshots and earlier handoffs retain their original evidence dates.

Next action: integrate this scoped commit after `572f2b9`, verify the static app, and recapture only the changed scenes. Root owns publication and live handoff integration. Remaining local changes should be clean at handoff; the final message records the commit and check result.
