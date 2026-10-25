# Website demo mode and funded marketplace

Objective: give pactlane.io an explicit simulated mode, a simpler exchange page, a separate Why Pactlane tab, a sidebar extension install card and a marketplace that excludes unfunded offers.

Execution host: Mac mini. Owner device: MacBook Pro. Worktree `/private/tmp/pactlane-demo-toggle-20261025`, branch `codex/pactlane-demo-toggle`, production-source base `37ebed4` over `6ae9791`. The original Documents checkout is unavailable to this process; no alternative path was used to bypass that restriction. This isolated worktree preserves the current production app/media baseline.

## Behavior

- `/` defaults to live browser services; `/?demo=1` loads only the existing simulated adapter. Switching mode reloads the document to end the old mode's listeners and pending callbacks. It never copies a demo wallet, trade, balance or payment into the live adapter.
- Demo remains a full seller funding → buyer reserve → payment lock → verification → settlement walkthrough, including existing failure/recovery paths. Local demo storage uses its existing separate key. Demo responses use `connect-src 'none'`; no API, bank or wallet-extension request is necessary.
- Draft and pending demo deposits remain in the seller workspace. Only confirmed, unconsumed funded offers appear on the buy page; an empty marketplace has no quote panel. The live browser reads only the host's offers array; the mainnet candidate host already filters it to confirmed `Funded`, unexpired chain orders. No client draft is promoted to that array.
- The main exchange loses the inline Why section, setup box and repeated demo disclaimers. Why is a fourth navigation tab. The existing published Pactlane TLSNotary release is linked from one sidebar card. Mobile navigation has four visible tabs.
- Bank-proof, wallet and chain safeguards retain actionable errors. Removing prototype copy does not assert live transaction readiness.

## Current capability boundary

The existing Cloudflare Worker has only a static ASSETS binding. No exchange backend is attached to pactlane.io yet. Live mode therefore receives explicit HTTP503 from `/api/*` and shows an unavailable state instead of fabricated market data. Its same-origin client is the reviewed implementation imported from mainnet candidate `674670a`; the proof/Fly service, signer, policy store and contract were not changed by this website work. WalletConnect is disabled pending real deployment configuration. No external wallet relay is added to CSP.

Mainnet work continues separately at `/private/tmp/pactlane-mainnet-completion-20261025`, branch `codex/pactlane-mainnet-completion`, last verified commit `674670a`. A complete historical Revolut record was accepted server-side at 23:08:23 UTC, but no wallet/identity binding, new trade payment, escrow funding or release is established. The proposed test remains 1 USDC for EUR0.89. Payment gate: `NOT_CLEARED`.

## Checks

102 app/release tests passed. Headless Chrome completed the full simulated trade, checked draft and pending-funding exclusion, removal after reservation, no API/wallet calls in demo and no sample state visible after switching to live. Desktop/mobile navigation and overflow checks passed at widths 320, 390, 760, 1024 and 1440, with zero page errors. Evidence: `evidence/release/demo-mode-browser-2026-10-25.json`; screenshots and detailed logs stay ignored under `.private/ui-check`.

The build contains 42 allowlisted assets plus four generated files. Exact-file audit and Wrangler dry run passed with ASSETS as the only binding. Existing social images, fonts, favicon, video/narration, base stylesheet and demo model/adapter/presentation remain byte-identical. Vendor wallet code uses the mainnet candidate's existing pinned Freighter API 6.0.1 and WalletConnect 2.26.0 / QRCode 1.5.4 / esbuild 0.28.2 browser bundle. No dependency installation or update occurred.

Build: `node scripts/build-demo.mjs --media-dir /private/tmp/pactlane-live-social-20261025/dist/demo`; then `node scripts/audit-demo.mjs`. Local preview: `PACTLANE_PREVIEW_PORT=17864 node scripts/serve-demo.mjs`. Loopback is a developer check, not the MacBook handoff.

## Publication and next action

Published source: `a492f13557cd88b97b9ecf49f619084982238e25`. Cloudflare Worker `pactlane-demo` now runs version `c7154099-63c9-4c7b-987d-cb0b7f706aa4` at 100%; deployment `b2b2b9ec-70ee-4506-a002-e09295b066a0` was created at 23:23:12.687 UTC. Prior production version `98f4d8fa-ed5e-4cfe-a45c-07db641aa6d6` remains the rollback reference. No source push to GitHub occurred.

Public browser verification completed at 23:23:32.548 UTC: default live UI, explicit demo toggle, demo connection-blocking CSP, sidebar extension link, separate Why tab, mobile navigation and no sample offers in live mode all passed with zero page errors. All 42 served asset hashes matched the clean source build. Both www/app aliases returned308 preserving `?demo=1`. The real API returned its expected explicit503; this is not live trading acceptance. See `evidence/release/demo-mode-live-2026-10-25.json`.

Owner handoff: https://pactlane.io/ (live UI) and https://pactlane.io/?demo=1 (full simulated flow). No local preview is needed on the MacBook. The following documentation commit records this publication; it is not another deployed source version. Remaining untracked artifacts are ignored `.private/ui-check`, `dist/demo` and local dependency links; there are no pending source changes after that commit.

After this website change, compose the durable, configured mainnet exchange host and serve/proxy its authenticated same-origin routes. Carry this frontend into that host and update its static allowlist before switching the public backend. Prepare actual contract deployment/funding transactions for owner review and signing; keep the historical payment separate from the new trade. Do not instruct the owner to send EUR0.89 before escrow is confirmed locked and the verification service is ready.
