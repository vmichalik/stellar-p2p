# Pactlane handoff, 26 October 2026

## Result

The owner-approved mainnet trade is complete: **EUR 0.89 paid through Revolut, verified with TLSNotary, and 1 Circle USDC delivered to the buyer**. Order 0 is `Released`. The release succeeded at 09:52:33 UTC in ledger 65144514.

[Mainnet receipt](release/mainnet-result.md) · [Sanitized evidence](../evidence/release/mainnet-trade-2026-10-26.json) · [Release transaction](https://stellar.expert/explorer/public/tx/ec4220af4056b185d242977385484066789824a2a274f57b3439e1e4dd1b9864).

RPC token events and before/after balance reads confirm exactly 1 USDC moved from escrow to the buyer, leaving escrow at zero. The on-chain payment-used marker is true. Canonical `reconcileRelease` completed at 09:54:58 UTC and marked the durable payment record settled. **Payment release gate: CLEARED for order 0.**

## Execution and source

Work runs on Vijay's Mac mini; wallet and bank approvals happened on his MacBook Pro. The Documents checkout remains inaccessible under macOS privacy controls and was untouched. Active worktree: `/private/tmp/pactlane-mainnet-live-20261026`, branch `codex/pactlane-mainnet-live`. The trade ran on application source `b82c42d`, followed by evidence commit `8171faf`. Subsequent source `c5f1d9a` published the completion copy and film; `a568b19` switched static capability metadata to the live API. The current repair adds durable seller-created drafts and public discovery files. The publication receipt records the final source and serving versions.

The application repository is private: `vmichalik/stellar-p2p`. The extension repository is public. No wallet key, bank cookie, raw bank response or private policy seed belongs in Git. The owner approved this one 1 USDC trade and a combined 25 XLM deployment cap. Deployment actually cost **17.2118712 XLM**. Further trades require fresh terms and wallet approval.

## Deployment

- Public app: `https://pactlane.io/`; Demo mode remains available through its toggle or `?demo=1`.
- Proof service: `https://stellar-p2p-proof-vijay.fly.dev`.
- Escrow: `CAKZENBU32SNOAQQ34T2VATTZJYI5BPQW3WZVUVYIXWVTG5Q5R6TOHO5` on Stellar mainnet.
- Circle USDC contract: `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`.
- Serving Fly machine: `830d12add66258`, cdg. Encrypted 1 GB volume: `vol_vz80xl0nk9wy5xjv`, mounted at `/data`.
- Trade image: `sha256:4e63deb155e8799d488bca10069011200c5f165ec9912c778f11f56c256ff7f4`; Worker at trade time: `66f37f12-7c6d-4cf6-ae24-f2586e369531`.
- Old machine `85e769b4196298` is stopped with public routes removed. Do not restore old routing or replace durable state to roll back application code.

Private owner inputs, bank binding, policy seed, deployment journal, authorization/replay databases and exchange journals are under `/data/pactlane/operator`. Accepted normalized records are under `/data/pactlane/evidence`. Four proof records represent two unique bank payments: the historical identity anchor and the new EUR 0.89 payment. Duplicate proofs did not create another eligible payment.

## Checks and observations

The operator implementation passed 383 JavaScript tests, eight preparation checks and protocol synchronization. The subsequent pinned-asset gateway run passed 22 cases; the operator startup/origin/key-approval test passed. The fee/submission correction passed 33 focused tests. Those runs preceded the successful real-wallet trade; the final copy/error-message checks are recorded with publication.

The first code-upload attempt expired without inclusion. RPC, Horizon and the unchanged source sequence were reconciled before the owner retried. The fixed bootstrap preserves RPC outcomes and privately retains signed envelopes; unknown submissions remain fenced. No fee was charged for the expired attempt.

One browser payment-policy lookup failed before a wallet signature and displayed misleading transaction-pending copy. No release transaction existed at that point. The canonical server policy subsequently accepted the same record; the owner refreshed, signed the release and received USDC. The first lookup's cause was not established. The UI correction distinguishes a failed payment lookup from an unknown transaction and clears stale displayed authorization.

The mainnet proof used the existing extension and pinned verifier. No new bank payment, bank proof or extension build is needed to finish this trade. After a future payment lock, recovery still requires valid payment proof or both wallets' approval.

## Remaining submission work

The README, evidence index and submission answers now lead with the completed mainnet trade. The film's evidence card uses its confirmed amounts and receipt; product scenes use the app's sample trade. Repeated version/demo badges and development captions are removed. Owner-browser screenshots may replace the sample screens if desired, with private bank details cropped out.

Confirm the portal fields and judges' access to the private application repository, then submit and retain the portal receipt. No portal submission is recorded in this thread. Current assets and checks are linked from [submission media](release/submission-package.md).

## Offer creation and website discovery

The original live operator configuration contained one prepared draft and no creation action. After the first trade, its seller had no new offer to fund; the buyer wallet also correctly had no seller draft. The repair adds an authenticated `createOffer` action, private durable draft storage and a seller form. Only the bound seller may create; other wallets get a switch-wallet action. Server-derived recipient details and the existing 1 USDC offer ceiling remain in force. Each new price is matched against confirmed on-chain terms, while payment identity and replay checks remain unchanged. Funding still requires a separate wallet signature, and only confirmed funded offers enter the marketplace. No further real trade was executed during this repair.

153 app, focused integration and release tests passed. Independent subagents reviewed the host/payment changes and exercised the live UI with synthetic API data at 390px and 1440px: two private drafts, no funding commands, no public offers, no JavaScript errors or overflow. Persistence, same-second identical quotes, wallet isolation, amount mismatch and cross-order replay checks passed. The existing 64-entry catalog limit remains.

The website build now includes `/llms.txt`, `/robots.txt` and `/sitemap.xml`, with canonical root indexing and crawler exclusions for API/setup/proof paths. Published application source is `e71563b2780afb4570a9b3c28481e55d81c82d61`. [Publication receipt](../evidence/release/offer-discovery-publication.json) confirms all 46 public files match, all discovery endpoints return HTTP 200, the API is healthy and the prior order remains Released with a SETTLED policy record after restart. Serving Fly image: `sha256:3ec8cfd5688660b65be80550d4c41dc0f862bd698b48a4cc4bd7aa5e8df0ce95`; website Worker version: `9827f1d0-8690-471e-847d-ed0e2efb1e3a`. The application changes are committed and published; the only follow-up source change is this publication record. No local implementation changes remain. After publication, the next owner action is to refresh Pactlane, select seller wallet ending BMXT, choose Sell USDC and create an offer. Only fund it after reviewing its terms in the wallet.

## Embedded walkthrough

The Why Pactlane page now embeds the existing 90-second film with native playback controls, seeking and inline mobile playback. It uses the same reviewed MP4; no footage was changed. The website response permits same-origin media on its app document while demo API connections remain disabled. Local preview now supports byte ranges for seeking. All 16 release tests passed; Chrome playback and seeking passed in both modes at 390px and 1440px with no media errors, page errors, CSP violations or overflow. This is a website-only update; the Fly payment service is unaffected. Publication and live browser evidence are recorded in `evidence/release/embedded-video-publication.json`.
