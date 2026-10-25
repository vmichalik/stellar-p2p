# Domain and release-source handoff

Objective: prepare Pactlane's app/proof domain topology, research-backed metadata and stable source intake. Execution host: Mac mini. Worktree: `/Users/vijay/Documents/workspace-personal-projects/pactlane-integration`; branch `codex/pactlane-integration`. This is local preparation. No DNS, cloud resource, deployment or new remote push was performed by this lane.

## Current candidate

- App `https://pactlane.io`; aliases `www.pactlane.io` and `app.pactlane.io` redirect with path/query preserved.
- Workers Static Assets configuration is root `wrangler.jsonc`, Worker `deploy/demo/worker.mjs`. Only built-in ASSETS; no paid service bindings, schedule, source maps or observability. workers.dev and preview URLs disabled.
- Exact deploy input is ignored `dist/demo`; its `manifest.json` lists each asset/hash and intended origins. `npm run check:demo -- --record` records the exact output inventory and hashes in `.private/release/domain-bundle.json` after the final build. Source/config fingerprints belong in the companion domain verification record.
- Metadata, favicon, 1200×630 social card, robots/sitemap and restricted headers are prepared. The help link retains the current operational Fly URL until the proof transition is verified.
- Product direction copied from coordinator-reviewed `docs/positioning.md`: payment-to-release uncertainty for existing Stellar/Revolut users. No cheapest, instant, anonymous, first, trustless or no-disputes claim.

## Stable source intake

TLS local bundle verified against baseline `8074126`. Scoped source from `38eb912`, `f433423`, `2c98f8e86ee3fb6c9f89c14883c43b0a0d38f03a` is integrated from the local bundle, not a moving worktree. TLS-only canonical docs/package were reconciled rather than replacing the integrated app/policy/escrow description. `evidence/proof-runtime-snapshot.json` records source and bundle hash; source-specific uptime observations are not a new live test by this lane.

Policy follow-up `668adfc147ff83cbc6f647ffa50a9b4b6d37d820` is integrated as `9be14e2`: browser-safe presentation tokens, 55 policy tests, no protocol or live-normalizer change. Bank source namespace remains `https://app.revolut.com`; product domain migration never changes payment identity encoding.

**Final app accepted:** `572f2b92289f3466e4db2bde4fc6bb739e513f4a` is integrated as `4181b31`. Both presentation gaps are fixed and tested: recovery proposals retain verification of an unreported timely payment, and expired unlocked Reserved orders retain refund. The new `presentation.mjs` is explicitly allowlisted. Revised demo narration and shot list are included; the rendered silent video is separate and optional.

## Proof migration: root-owned, not executed here

Operational URL stays `https://stellar-p2p-proof-vijay.fly.dev`. The coordinator created a Fly certificate request, but DNS and issuance were pending in its 14:09 UTC record. Proposed DNS-only Fly records: A `66.241.125.78`, AAAA `2a09:8280:1::1cc:72cc:0`. Root owns DNS/auth and preserves unrelated records.

This source now supports optional `TLSN_BENCHMARK_PUBLIC_ORIGIN=https://proof.pactlane.io`. Default stays the exact Fly hostname. `render-fly-config.mjs` accepts it as the fourth argument; `prepare-proof-benchmark.py` accepts `--public-origin` and validates it before staging/download. The cloud startup reads this benchmark variable, not the older private launcher's `TLSN_PUBLIC_ORIGIN`.

After DNS and cert are independently verified, root/proof owner can stage the exact reviewed source, configure that explicit origin and verify derived WebSocket/plugin/CSP/consent destinations, route-specific COEP, health/version and a bank-free flow. Keep the same two fixed targets, crypto settings, budgets and deadlines. Do not switch the running Fly origin before routing works; do not redirect or transfer old bank consent. Bank tests remain paused.

After acceptance, update `SITE.proofDomainVerified` and the operational runbook. Domain ownership and a certificate request are not service availability.

## Verification and next action

The new domain/config/redirect tests and integrated JS suites pass; details and exact source hashes are in the domain evidence record. Worker dry run uses installed official Wrangler 4.152.0 and creates no service. Source syntax/format checks and Python preparation tests run locally. The prior compiled-WASM rehearsal remains local/synthetic; none of this establishes a bank payment or network settlement.

Root can now review the frozen final app candidate, inspect the exact manifest/config, deploy with its existing authorization, and verify the public result. Proof migration is a separate root-owned step after DNS/cert. The bank-test pause remains.

The duplicate coordinator's exact TLS branch push was previously rejected by automatic approval review for insufficient publication authorization. This lane has not retried that push through another route. The local TLS integration is not authorization to push its source remotely.

## Optional media intake prepared

Root may provide reviewed `demo.mp4` and `demo-script.txt` through explicit `npm run build:demo -- --media-dir …`. No media is included by default; no video UI link was added. The exact two-file whitelist, strict size/regular-file/container/text checks, per-file hashes and private source-path provenance are implemented. MP4 stays outside Git. Playback permission is same-origin and limited to a present exact video response. This can ship after the app and is not a reason to hold the final app snapshot.

## Final app publication candidate

The branch HEAD after the final freeze is the ready source commit; `dist/demo/manifest.json` records that same revision after rebuilding. `.private/release/domain-bundle.json` is the exact 14-file/hash inventory, with `sourceDirty: false`. These generated artifacts stay ignored; they are review/deploy inputs, not a new source push.

Final checks: 202 JS tests passed (125 root including 21 app/10 release, 55 policy, 11 canonical protocol, 11 wallet/RPC), zero skipped/failed; 8 Python preparation tests passed; shared protocol sync passed. Wrangler 4.152.0 dry run passed with ASSETS only. Final built-page smoke shows the new hero, synthetic badge, start-as-seller guidance, canonical/OG metadata, retained noindex and operational Fly help link, with no console warning/error. Syntax/format and diff checks pass. Earlier native/WASM results remain pinned to the unchanged contract; no broader Rust rerun was needed for presentation/domain changes.

Publication readiness applies to the synthetic app only. No deployment, DNS change, bank test, origin cutover, accepted real payment or network settlement was performed by this lane. The proof domain remains pending. Root owns external publication and reachability verification.
