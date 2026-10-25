# Live social image update

Completed on the Mac mini on 25 October 2026 for the explicit instruction to update social cards and OG images on pactlane.io.

Production source: `6ae97918fc90c6c23507399f82d31c4a74f5d094`, branch `codex/pactlane-live-social-images`, worktree `/private/tmp/pactlane-live-social-20261025`. The source starts from the exact deployed app revision `88ba889f1927ec9283b45c2120d9c8df6a661419`. Its unmodified rebuild matched all 12 prior live asset hashes, including the existing film and narration. The following documentation/evidence commit does not identify another deployment.

Active Cloudflare Worker: `pactlane-demo`, version `98f4d8fa-ed5e-4cfe-a45c-07db641aa6d6`, 100% traffic. Deployment `6e7c4dc3-5ff6-4d8e-8455-6db619808f88` was created at 22:25:37 UTC. Previous version `e95529b6-f423-483e-a19c-f95c44e43508` remains the rollback reference; no rollback was performed.

## Published changes

The seven approved designs are all public in PNG and JPEG under `/assets/social/`: `og-default`, `og-dark`, `social-link-wide`, `social-landscape`, `social-square`, `social-portrait`, `social-story`. Their artwork comes byte-for-byte from creative commit `8b904c0e82539b2c4952d730e16e909b02c65f8f`. The legacy `/assets/social-preview.png` now serves the new default PNG.

The homepage HTML uses a content-versioned primary OG image at [og-default-32116a99787d.jpg](https://pactlane.io/assets/social/og-default-32116a99787d.jpg), 1200×630, and a dedicated X image at [social-link-wide-a7593d7d0e8e.jpg](https://pactlane.io/assets/social/social-link-wide-a7593d7d0e8e.jpg), 1200×600. Metadata includes absolute image URLs, MIME type, dimensions and alternative text. Preview copy follows the bank app / human supplier / Stellar wallet narrative without development-stage or dated launch labels. Content-versioned URLs distinguish the new images from older cached image resources.

## Verification

Ten release tests passed, and the exact staged asset inventory passed. Before activation, runtime settings and the ASSETS-only binding matched the existing Worker; routes/configuration, Worker fetch behavior and security-header source were unchanged. Version activation did not deploy triggers or DNS changes.

All 28 deployed asset hashes and byte sizes matched the build, including every image, the existing app modules, styles, fonts, favicon, video and narration. Public image MIME types passed. Facebook, X and LinkedIn user-agent requests received HTTP200 and the new tags in server HTML. Both aliases returned308 with path/query preserved in normal-browser curl checks. The initial Python default-client alias HEAD request returned403; no access-control change was made, and the normal-browser checks passed. These requests do not establish the contents of third-party social-platform caches.

The new public manifest SHA256 is `9466e26ff83b3912e3dddfeacc132cb0fb1eafa5ec3d2dbf94c2f885f0bba36a`. The prior 10 app/media assets outside the HTML and legacy image remain byte-identical. Proof origins, payment gates, wallet/RPC/policy/contracts and published video content were outside this deployment change. No bank or wallet interaction occurred.

See [the public evidence](../../evidence/release/social-images-live-2026-10-25.json). Full runtime/upload logs remain ignored in `.private/live-social`; they are not public assets. The source publication to GitHub was not part of this site update.

## Continuation

The live update has no outstanding deployment work. Keep production source and Worker version distinct from this documentation receipt. Future image changes should create new content-versioned JPEG filenames, update `deploy/demo/social.mjs`, rebuild from the current production app with its exact reviewed media, inspect the scoped asset diff, then verify the public tags and hashes after authorized activation. Existing social posts may retain their platform's cached preview until that platform fetches the page again.
