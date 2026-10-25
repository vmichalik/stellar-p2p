# Website deployment

The existing Cloudflare Worker `pactlane-demo` serves [pactlane.io](https://pactlane.io/). The www and app aliases redirect to the canonical host while preserving path and query.

## Build and inspect

```sh
npm run build:demo
npm run check:demo
npm run preview:demo
```

The build copies only the explicit public asset list into `dist/demo`, records SHA-256 hashes and writes the canonical metadata, security headers, robots and sitemap. Source, private configuration and payment evidence are not public assets.

`/?demo=1` loads the sample adapter with connections blocked. The default page loads the same-origin host client. The current static Worker returns503 for API routes until the configured exchange backend is attached; it never substitutes demo responses.

Root `wrangler.jsonc` owns the existing Worker and domain routes. `deploy/demo/site.mjs` and `social.mjs` own metadata and reviewed image paths. ASSETS is the only binding; no signer or payment service runs inside this static Worker.

## Publish

Build from a clean reviewed commit. Check the exact asset inventory and current Worker version, upload a version, inspect its settings, then activate it on the existing routes. Verify HTTPS, redirects, MIME types, mode behavior and all published hashes. Record the source commit, version and rollback reference in the [handoff](../../docs/handoff.md).

## Reviewed media

```sh
npm run build:demo -- --media-dir /absolute/path/to/reviewed-media
```

Only `demo.mp4` and `demo-script.txt` are copied from that directory. The manifest records their hashes and sizes. Review the actual footage before publication; the package check only validates file type and size. Keep the existing reviewed files when a UI-only deployment should preserve media.

The proof service remains at its verified Fly origin until a separate domain change is configured and checked. See [proof operations](../../docs/proof-handoff.md).
