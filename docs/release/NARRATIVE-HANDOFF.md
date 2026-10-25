# Published narrative and mobile release

Objective: record the verified narrative/app/video publication and complete a documentation/evidence-only intake while preserving frozen deployed source and assets. Execution host: Mac mini, 25 October 2026. Worktree: `/Users/vijay/Documents/workspace-personal-projects/pactlane-integration`; branch `codex/pactlane-integration`. Base docs/source HEAD was `e33041f684bc6897d4d6ee0613bd095e6a804b39`. The published application source is `88ba889f1927ec9283b45c2120d9c8df6a661419`. The completion message supplies the separate documentation-only HEAD; use `git rev-parse HEAD` and `git status --short` before continuing.

## Current publication — 25 October 2026

- App: [pactlane.io](https://pactlane.io). Silent film: [demo.mp4](https://pactlane.io/demo.mp4). Matching narration: [demo-script.txt](https://pactlane.io/demo-script.txt).
- Published source: `88ba889f1927ec9283b45c2120d9c8df6a661419`, including UI source `5bd17fde42340d898435eaecd873ba25366c32ee`. A later docs HEAD does not identify a new deployment.
- Coordinator-reported Worker: `e95529b6-f423-483e-a19c-f95c44e43508`. The Worker identifier comes from deployment handoff, not an HTTP-exposed identifier.
- Public manifest SHA-256: `57976a8918229887b98629139bf2f94ed729bad6acf2181b3f51b8fd886ebebe`.
- Video SHA-256: `49f8ec2b46b35981bcee0398ed0206dcafa5131e20afa24be608a8eba2129436`; matching script SHA-256: `d664a70fae94ce25d3d9bbb2e29769a8f925beef2172fa716b3311fd7e293645`.

The [public narrative audit](../../evidence/release/public-narrative-2026-10-25.json) records all 67 required checks passing, 67/68 overall. All 12 assets match their hashes. The optional Range check returned HTTP 200 and the full verified MP4 rather than 206; byte-range seeking remains unverified. Keep that limitation visible rather than claiming every check passed.

The coordinator's public desktop review confirmed the narrative, expanded privacy limits and video link, with no console warning/error. Browser playback showed 180 seconds at 1920×1080 without error. The reviewed media record reports 30fps, zero audio streams and successful decode. Public desktop smoke is distinct from the responsive/full synthetic walkthrough checked on identical source before publication. This intake validates the supplied evidence; it does not rerun public, payment or deployment checks.

The concept remains unchanged from its prior approved intake. Positioning, coordination and the revised narration/shot list are copied verbatim from the coordinator's canonical files. Frozen `dist/demo`, all pre-existing evidence and source/config are preserved. Only the new public narrative evidence record is added.

The app and film are synthetic demonstrations. Authenticated payment acceptance, confirmed testnet settlement and proof-domain DNS/certificate cutover remain open. The operational proof origin stays on Fly; no bank action or proof DNS login is requested here.

## Scoped source intake

1. UI source `32e1c2c0280dd779a926a01661947f8e10610d11` became `0f0d544d0989be546ef51226eaccf532756514d8`: floating mobile navigation and desktop verification guide.
2. UI source `5bd17fde42340d898435eaecd873ba25366c32ee` became `e9f7453c1059fdd8d5df62c4048fb1b97f4fdaaa`: motivation, peer seller margin, sample pricing and setup limits.

The source UI worktree was clean at the second commit. Its [mobile handoff](../ui/mobile-handoff.md) and [positioning handoff](../ui/positioning-handoff.md) explain the exact scope, screenshots and limitations. The latter guide wording supersedes the earlier guide screenshots.

`deploy/demo/site.mjs` rewrites index title/description/social fields during packaging, so SITE.description is aligned explicitly: “Pay someone through Revolut and receive USDC in a Stellar wallet. Explore the peer-to-peer prototype with sample payments and simulated settlement.” Title, social image, origins and security remain unchanged. No implemented anonymity, zero retention, lower cost or automatic fee redistribution is claimed.

## Checks and preserved boundaries

- 21 app tests and 10 release tests passed; 79 JavaScript/module/inline syntax checks passed. Scoped formatting and whitespace checks passed.
- At the source-intake checkpoint, before/after hashes confirmed the existing `dist/demo` and `evidence/` trees were unchanged. Release fixture tests wrote only temporary synthetic outputs; that lane did not build the final public bundle.
- Model, demo adapter, presentation helpers, live declarations, contracts/protocol, policy, wallet/RPC integration, proof runtime, build scripts and Worker configuration/security remain unchanged by this intake. The bank namespace remains `https://app.revolut.com`.
- The desktop guide is explanation/checklist only. It is not cross-device resume, extension readiness detection, live proof launch or payment authority. The walkthrough sends no bank data.
- Before this publication, the preceding deployed code was `1c7f03865be9f0f89c17364c4456bd2e042e8be9`, Worker `62f5ce60-6c34-43d3-ad84-a119d660b407`. Those are historical release identifiers, superseded by the current publication above. Previous WASM evidence remains intact.

## Documentation intake and next action

This follow-up copied the five requested canonical documentation/evidence files and updated only this handoff plus the supersession note in DOMAIN-HANDOFF. Local link, JSON/evidence consistency, exact-byte copy, credential-marker, scope and whitespace checks are appropriate to this prose-only change. No code-test rerun, rebuild, deployment or push is part of the intake.

Keep the published source, manifest and media hashes above as the deployment reference, separately from the new docs HEAD. The working tree should be clean at completion. Further code, publication or proof work needs its own scoped instruction; the unchanged live-payment, testnet and proof-DNS gates are not cleared by the public demo.
