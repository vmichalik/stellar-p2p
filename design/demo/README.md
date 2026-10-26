# Pactlane film

The 90-second composition uses captures of the integrated app in Demo mode. Its evidence card records the completed 26 October mainnet trade: EUR 0.89 paid through Revolut and 1 USDC released to the buyer. The layout, local Manrope font and restrained transitions match the website.

Open `index.html` through a local HTTP preview. Its paused GSAP timeline is exposed as `window.__timelines.pactlane` for deterministic seeking. `hyperframes.json` retains the composition's project settings. Render at 1920×1080, 30fps without audio.

The mainnet card uses [verified receipt data](../../evidence/release/mainnet-trade-2026-10-26.json). Product scenes follow the app’s sample trade. Follow the [shot list](../../docs/demo/shot-list.md) for owner-browser captures; keep bank details out of screenshots and Git.

Manrope is bundled with its OFL notice. The unchanged GSAP runtime retains its licence header. The source capture and render checks are linked in [verification](../../docs/verification.md).
