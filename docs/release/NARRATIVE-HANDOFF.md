# Narrative and mobile source freeze

Objective: integrate the approved presentation-only UI/mobile revision and align production metadata, without changing the existing deployed bundle. Execution host: Mac mini, 25 October 2026. Worktree: `/Users/vijay/Documents/workspace-personal-projects/pactlane-integration`; branch `codex/pactlane-integration`. Base docs/source HEAD was `e33041f684bc6897d4d6ee0613bd095e6a804b39`. The completion message supplies this freeze's exact commit; use `git rev-parse HEAD` and `git status --short` before continuing.

## Scoped intake

1. UI source `32e1c2c0280dd779a926a01661947f8e10610d11` became `0f0d544d0989be546ef51226eaccf532756514d8`: floating mobile navigation and desktop verification guide.
2. UI source `5bd17fde42340d898435eaecd873ba25366c32ee` became `e9f7453c1059fdd8d5df62c4048fb1b97f4fdaaa`: motivation, peer seller margin, sample pricing and setup limits.

The source UI worktree was clean at the second commit. Its [mobile handoff](../ui/mobile-handoff.md) and [positioning handoff](../ui/positioning-handoff.md) explain the exact scope, screenshots and limitations. The latter guide wording supersedes the earlier guide screenshots.

`deploy/demo/site.mjs` rewrites index title/description/social fields during packaging, so SITE.description is aligned explicitly: “Pay someone through Revolut and receive USDC in a Stellar wallet. Explore the peer-to-peer prototype with sample payments and simulated settlement.” Title, social image, origins and security remain unchanged. No implemented anonymity, zero retention, lower cost or automatic fee redistribution is claimed.

## Checks and preserved boundaries

- 21 app tests and 10 release tests passed; 79 JavaScript/module/inline syntax checks passed. Scoped formatting and whitespace checks passed.
- Before/after hashes confirm the entire existing `dist/demo` and `evidence/` trees are unchanged. Release fixture tests write only temporary synthetic outputs; no final public bundle was built.
- Model, demo adapter, presentation helpers, live declarations, contracts/protocol, policy, wallet/RPC integration, proof runtime, build scripts and Worker configuration/security remain unchanged by this intake. The bank namespace remains `https://app.revolut.com`.
- The desktop guide is explanation/checklist only. It is not cross-device resume, extension readiness detection, live proof launch or payment authority. The walkthrough sends no bank data.
- Published code remains `1c7f03865be9f0f89c17364c4456bd2e042e8be9`, Worker `62f5ce60-6c34-43d3-ad84-a119d660b407`. This source freeze is not a deployment. Existing app/media and previous WASM evidence are preserved.

## Next action

Root completes independent browser/metadata review and supplies the reviewed new MP4/script. Only then build the final bundle with explicit media intake, record the exact manifest and publish through the existing approved Worker workflow. The current `dist/demo` is still the old deployed revision; do not describe it as this new source.

No final build, deployment, remote push, protocol change, bank test, proof DNS login or credential-scope change was performed. Proof DNS remains pending and the operational Fly origin stays unchanged. The source tree should be clean at completion.
