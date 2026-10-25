# Pactlane social image system

An editorial image set built from Pactlane's existing Manrope font, paired-frame emblem, warm ivory, terracotta and forest green. The new 3D artwork echoes the original emblem; the exact outlined brand mark remains in the wordmark. Copy centers the existing bank app, a human supplier, an upfront price and the user's own Stellar wallet. The layouts have no development-stage labels or date-dependent launch language.

## Export set

Each design is available as an opaque RGB PNG and a quality-95 sRGB JPEG in `app/assets/social/`. Prefer JPEG for small link-preview payloads; use PNG when lossless typography matters. The manifest records exact dimensions, byte sizes, SHA-256 hashes and ready-to-use alt text.

| File stem          | Size        | Use                                               |
| ------------------ | ----------- | ------------------------------------------------- |
| `og-default`       | 1200 × 630  | Primary website/link-preview image                |
| `og-dark`          | 1200 × 630  | Forest-green brand alternative                    |
| `social-link-wide` | 1200 × 600  | Dedicated 2:1 link card                           |
| `social-landscape` | 1600 × 900  | Landscape social post                             |
| `social-square`    | 1080 × 1080 | Square feed post                                  |
| `social-portrait`  | 1080 × 1350 | Portrait feed post                                |
| `social-story`     | 1080 × 1920 | Vertical story with generous top/bottom clearance |

These dimensions are deliberate export choices. Platform crops and overlays vary; review the actual placement before posting. `review/contact-sheet.jpg` previews the complete set.

## Editable source and rendering

`index.html` contains the layout, CSS and card copy. Open it with `?card=og-default` or another file stem to inspect a design at its native size. All fonts and artwork are local. `source/pactlane-pair.png` preserves the original transparent artwork; `source/ART_PROMPT.md` records the exact built-in image-generation prompt. No CLI/API image-generation fallback was used.

Run `node design/social/render.mjs` from the repository root in an environment with Playwright and Chrome available. `PACTLANE_PLAYWRIGHT_MODULE` can point to an existing Playwright module; `PACTLANE_CHROME_PATH` can select the installed Chrome executable. No new dependencies are installed by the renderer. Chrome sandbox and context isolation remain enabled, and external HTTP(S) requests are blocked.

The renderer exports both formats, checks fonts/images, exact canvas size, text bounds and spacing, opaque-art clearance above the footer, page errors, external requests and a conservative 5 MB file ceiling. It refreshes the manifest and review report. The exported artwork is flattened over each card's intended background; the editable source artwork retains alpha.

## Website metadata

Use `metadata.mjs` to generate server-visible tags for the real canonical HTTPS URL and public image directory:

```sh
node design/social/metadata.mjs https://your-public-site.example/ https://your-public-site.example/assets/social/
```

The `.example` URL is a placeholder, not a deployment. The helper emits absolute OG/X image URLs, exact dimensions, MIME type and alt text. Copy the two corresponding JPEGs to the public image directory and put the emitted tags in the page's HTML head, where crawlers can read them without JavaScript. If the deployment has an asset allowlist, add those image paths explicitly. No live site, build allowlist or financial runtime was changed by this image set.

OG image dimensions, MIME type and alternative text follow the [Open Graph protocol](https://ogp.me/#structured). The old official X card-documentation URL currently redirects to its API overview; the 2:1 export is a conservative dedicated layout, not a claim of a freshly verified platform requirement.

## Review and provenance

Prepared locally on 25 October 2026 from source candidate `2f6ab71ccdeb1995e44243de2b52758fc2f3bec5`, in the isolated branch `codex/pactlane-social-cards`. Financial/network implementation and the existing video/deck are untouched. The generated object artwork was visually inspected, and every final card is reviewed at full size and in the contact sheet. The user requested timeless branding; the final images, alt text and metadata follow that direction. No site deployment or social posting occurred.
