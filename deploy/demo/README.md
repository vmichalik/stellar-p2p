# Static demo deployment

Canonical app: `https://pactlane.io`. `www.pactlane.io` and `app.pactlane.io` redirect to the apex with path/query preserved. The coordinator owns publication and domain routing. This lane prepares source and artifacts only.

## Build and inspect

```sh
npm run build:demo
npm run preview:demo
```

The build copies nine allowlisted assets, renders canonical/social metadata and writes the synthetic hash manifest, security headers, robots and sitemap into ignored `dist/demo`. No policy, proof source, bank data or signer is copied. The preview binds only loopback; it is not a remote handoff.

`deploy/demo/site.mjs` owns metadata. Social preview is a checked-in 1200×630 PNG using the local licensed Manrope font. `scripts/render-social.py` is an optional Pillow authoring tool; building does not require Pillow. No analytics or external resource loading is added.

## Workers Static Assets candidate

Root `wrangler.jsonc` defines `pactlane-demo`, `dist/demo`, the built-in ASSETS binding and three custom domains. It disables workers.dev, preview URLs, source-map upload and observability. It configures no database, bucket, service, secret or schedule.

The Worker runs before assets so aliases redirect rather than render duplicate sites. It serves only GET/HEAD and refuses unknown hosts, including the proof hostname. Shared security headers apply to assets, redirects and errors; `connect-src 'none'` remains unchanged. There is no proof, bank, wallet or policy fetch.

This matches Cloudflare's [Static Assets](https://developers.cloudflare.com/workers/static-assets/) and [custom-domain configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#custom-domains). Worker-generated responses need their headers set in code, as described in [the header guide](https://developers.cloudflare.com/workers/static-assets/headers/).

The existing CLI passed `wrangler deploy --dry-run`. The coordinator should inspect the exact manifest and config, resolve any existing Worker/domain collision, deploy with its existing authorized account, then verify HTTPS, alias redirects, content types, CSP and the complete synthetic flow from another device. No cloud resource was created here.

## Proof domain remains pending

The intended proof origin is `https://proof.pactlane.io`. Its DNS/certificate transition is not established. `SITE.proofDomainVerified` stays false; the help link retains `https://stellar-p2p-proof-vijay.fly.dev/extension-check/`. The static app never calls either proof service.

See [domain handoff](../../docs/release/DOMAIN-HANDOFF.md) for the root-owned migration sequence and final app-intake blocker. Do not publish the old app snapshot while its two pending recovery fixes remain unintegrated.
