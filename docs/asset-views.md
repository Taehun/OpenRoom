# Asset pipelines: the offline view and product modes

`scripts/openroom-assets/` holds the two developer-run pipelines that call an
image model: `pnpm assets:views` fills in the **alternate views** of a cutout
that already exists, and `pnpm assets:products` photographs the **front-quarter
cutout** of a catalog product that has none. They share a provider adapter, a
retry ladder, an anchor measurement, and the rule that nothing they touch ever
runs at runtime or in CI.

## Views

OpenRoom ships one photographed 3/4-view cutout per product. That view and
its mirror already show every facing within 80° of the camera, so the demo is
complete without any generated asset. The remaining views — a profile, a rear
three-quarter, and a straight back — are produced **once, offline**, by
`pnpm assets:views`, checked into `public/demo/photo/`, and registered in
`src/features/photo/photo-views.generated.ts`.

These scripts are the only place in the project that calls an image model. The
app has no inference route, no API key, and no runtime generation;
`ASSET_PROVIDER` stays `cached`. CI never runs a pipeline, and no test ever
touches the network.

## What it does

For every base asset that needs a view it does not have yet:

1. Reads the photographed WebP from `public/demo/photo/{seed,products}/`.
2. Sends it to the configured provider (see **Providers**) with the prompt
   below. OpenAI gets a multipart `images/edits` request with the cutout as
   `image`, `background=transparent`, `output_format=webp`,
   `output_compression=100`, `input_fidelity=high`, `n=1`, `quality`, and
   `size=1536x1024` for a landscape reference or `1024x1536` for a portrait one;
   Gemini gets the same cutout as an `inlineData` part and the matching `3:2` or
   `2:3` aspect ratio. HTTP 429 and 5xx are retried three times, after 2s, 4s,
   and 8s.
3. Measures the floor anchor over pixels with alpha ≥ 16:
   `anchorX = (left + right + 1) / 2 / width`, `anchorY = (bottom + 1) / height`,
   rounded to four decimals. An image with no such pixel fails the job.
4. Writes `<assetId>--<view>.webp` (lossless) beside the reference.
5. Rewrites the manifest module after every completed job, so an interrupted run
   keeps everything it finished.

## Which views each category needs

Views come from the asset's symmetry class (`PHOTO_VIEW_SYMMETRY`):

| Category | Symmetry | Generated views |
| --- | --- | --- |
| `sofa`, `chair`, `unknown` | `none` | `side`, `back-quarter`, `back` |
| `coffee_table` | `front-back` | `side` (one image serves a facing and its opposite) |
| `floor_lamp`, `plant`, `rug` | `radial` | none — one image serves every facing |

`pnpm assets:views --dry-run` prints the exact job list for the current catalog
(the unit tests pin that count through `EXPECTED_VIEW_JOBS`).

## Commands

```bash
pnpm assets:views --dry-run                       # print the plan, make no request
pnpm assets:views                                 # generate everything missing
pnpm assets:views --product hinoki-low-sofa       # one asset (repeatable)
pnpm assets:views --view side --view back         # one view (repeatable)
pnpm assets:views --product hinoki-low-sofa --force  # regenerate an existing entry
```

Exit codes (both modes): `0` success or dry run, `2` bad arguments or no usable
key (outside `--dry-run`), `1` a job failed — the manifest still records the jobs
that completed.

Progress goes to stdout as `[views] <assetId>/<view> ok (anchor 0.50, 0.87)`.
Env values are never printed.

## Product cutouts

`pnpm assets:products` is the second mode. It plans one job for every catalog
product in `src/features/demo/demo-data.ts` that has no entry in `PHOTO_ASSETS`,
and for each one:

1. Asks the provider for a three-quarter product shot on a pure white studio
   background, at 3:2 or 2:3 (see the table below). Nothing is read from disk:
   there is no reference image, only the product's title and description.
2. Removes the background on the decoded RGBA buffer: the four corners give the
   background colour, a 4-connected flood fill starts at **every border pixel**
   and spreads only through pixels within 18/255 per channel of one of those
   samples, and everything it reaches gets alpha 0. A white pixel enclosed by
   the product is never reached, so it survives. The alpha edge is then
   feathered by one pixel, on the product side only, so no cleared pixel is
   given a white halo.
3. Measures the floor anchor exactly as the view mode does, over alpha ≥ 16.
4. For a rug, derives a default `floorQuad` from the alpha bounding box — the
   back edge inset by 10% of its width — and records `quadSource: "bbox"`. It is
   a starting point, not a calibration: replace it with a measured quad in
   `photo-assets.ts` when the rug matters.
5. Writes `public/demo/photo/products/<id>.webp` (lossless) and rewrites
   `src/features/photo/photo-products.generated.ts` after every completed job.

| Category | Aspect | Returned size (Gemini probe) |
| --- | --- | --- |
| `sofa`, `coffee_table`, `rug`, `bookshelf`, `chair` | `3:2` | landscape |
| `floor_lamp`, `plant`, `side_table` | `2:3` | 848×1264 |

The returned image's own pixel size is recorded as the intrinsic size; the
background removal never resizes.

```bash
pnpm assets:products --dry-run                    # print the plan, make no request
pnpm assets:products                              # generate every missing cutout
pnpm assets:products --product oak-side-table     # one product (repeatable)
pnpm assets:products --product oak-side-table --force  # regenerate a generated entry
pnpm assets:products --product oak-side-table --force --angle-reference hinoki-low-sofa  # match a photographed cutout's camera angle
```

`--force` only regenerates cutouts this pipeline wrote before. A hand-registered
cutout in `photo-assets.ts` is never overwritten, because the pinned catalog
assets, anchors, and quads do not change.

The prompt is:

```
Product photography of {title}: {description} Three-quarter view turned to the
viewer's right, the whole product visible with a small margin, standing on an
invisible floor, pure white studio background, no props, no text, no shadow, no
reflections.
```

`{title}` and `{description}` come from the catalog entry, so the model never
sees an id or a Scene enum.

`--angle-reference <assetId>` sends a registered cutout to the model as an
inline reference image and asks for the same camera height and quarter angle;
use it when a generated cutout is audited as facing the wrong way.

### The product manifest

`src/features/photo/photo-products.generated.ts` exports one array:

```ts
import type { GeneratedProductAsset } from "./photo-assets";

/** Written by `pnpm assets:products`; do not edit by hand. */
export const GENERATED_PRODUCT_ASSETS: GeneratedProductAsset[] = [
  {
    "id": "oak-side-table",
    "src": "/demo/photo/products/oak-side-table.webp",
    "intrinsicWidth": 848,
    "intrinsicHeight": 1264,
    "anchorX": 0.5012,
    "anchorY": 0.9822,
    "provider": "gemini",
    "model": "gemini-3.1-flash-image",
    "generatedAt": "2026-09-04T13:00:00.000Z"
  }
];
```

`PHOTO_ASSETS` is the union of the 24 hand-registered cutouts and this array,
validated with a strict Zod schema at import; a hand-registered entry always
wins. A generated product is therefore registered, selectable, composited, and
audited by `pnpm test:e2e` exactly like a photographed one. `provider`, `model`
and `generatedAt` are provenance only and never reach the compositor.

Once a product has its front-quarter cutout, `pnpm assets:views` picks it up
and plans its alternate views on the next run.

## Silhouettes

The compositor scales every cutout by its silhouette, not by its frame: a
product photographed with generous transparent margins would otherwise render
smaller than a tightly cropped one of the same width.

```bash
pnpm assets:measure   # measure every registered cutout's alpha content box
```

The script reads each PNG/WebP under `public/demo/photo/`, finds the box that
contains every pixel with alpha above 8 (as fractions of the image), and writes
`src/features/photo/photo-silhouettes.generated.ts`. `PHOTO_ASSETS` merges the
box in as `contentBox`, and `objectVisualWidth` divides the projected extent by
the box's width so the visible silhouette spans the object's real width. Rerun
it after any cutout is added or regenerated; the unit tests fail when a
registered cutout has no box.

## Providers

Both modes go through one `ImageProvider` adapter
(`scripts/openroom-assets/providers.ts`), so neither shell names an endpoint and
both share the 2 s / 4 s / 8 s retry ladder on 429 and 5xx. The key travels in a
header only and is never logged.

| Provider | Endpoint | Key header | Reference image | Default model |
| --- | --- | --- | --- | --- |
| `gemini` | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `x-goog-api-key` | an `inlineData` part | `gemini-3.1-flash-image` |
| `openai` | `POST https://api.openai.com/v1/images/edits` with a reference, `…/images/generations (unexercised: only the Gemini path has been run against the live API)` without | `Authorization: Bearer …` | the multipart `image` field | `gpt-image-1` |

The Gemini body is `{ contents: [{ parts: [{ text }, …{ inlineData: { mimeType,
data } }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: {
aspectRatio } } }` and the image comes back as the first part carrying
`inlineData` — `image/jpeg` in the verified probe, so the shell decodes by
content with `sharp` and never assumes PNG.

`OPENROOM_IMAGE_PROVIDER` decides when it is set. Unset, OpenAI wins if
`OPENAI_API_KEY` is present (so an existing setup keeps its behaviour), and
Gemini is used when `GEMINI_API_KEY` is the only key. With no key at all, both
modes exit 2 without opening a socket.

## Environment

Read from `.env.local` only (via `process.loadEnvFile`, and only when the file
exists), never from `.env` and never from any bundle:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Required outside `--dry-run` when the provider is `gemini`. Sent as `x-goog-api-key` and never logged. |
| `OPENAI_API_KEY` | — | Required outside `--dry-run` when the provider is `openai`. Sent as `Authorization: Bearer …` and never logged. |
| `OPENROOM_IMAGE_PROVIDER` | see above | `gemini` or `openai`. |
| `OPENROOM_IMAGE_MODEL_GEMINI` | `gemini-3.1-flash-image` | The Gemini image model to call. |
| `OPENROOM_IMAGE_MODEL` | `gpt-image-1` | The OpenAI image model to call. |
| `OPENROOM_IMAGE_QUALITY` | `high` | `low`, `medium`, or `high`; OpenAI only. |

## Prompt

```
Product photography of the exact same {category} shown in the reference image,
viewed from {viewDescription}. Keep the identical design, materials, colors,
proportions, and lighting. Same camera height and lens, centered, the whole
product visible with a small margin, standing on an invisible floor. Isolated
on a fully transparent background with no shadow, no floor, no props, no text.
```

`{category}` is the human label (`sofa`, `armchair`, `coffee table`,
`floor lamp`, `plant`). `{viewDescription}`:

- `side` — "its right side, a pure 90-degree profile with the front of the
  {category} pointing to the viewer's right"
- `back-quarter` — "behind and to the right, a three-quarter rear view with the
  back facing the camera and the front pointing away to the viewer's right"
- `back` — "directly behind, showing only the back of the {category}"

## The manifest

`src/features/photo/photo-views.generated.ts` is a checked-in TypeScript module
(not JSON, so Next, Vitest, Playwright's ESM runner, and `tsx` all import it
without import attributes) exporting one constant:

```ts
import type { GeneratedViewManifest } from "./photo-views";

/** Written by `pnpm assets:views`; do not edit by hand. */
export const GENERATED_VIEW_MANIFEST: GeneratedViewManifest = {
  "version": 1,
  "views": [
    {
      "assetId": "hinoki-low-sofa",
      "view": "side",
      "src": "/demo/photo/products/hinoki-low-sofa--side.webp",
      "intrinsicWidth": 1536,
      "intrinsicHeight": 1024,
      "anchorX": 0.5012,
      "anchorY": 0.8701,
      "model": "gpt-image-1",
      "generatedAt": "2026-09-03T13:00:00.000Z"
    }
  ]
};
```

Entries are merged by `(assetId, view)` and sorted by asset then canonical view
order. Loading validates the module with a strict Zod schema, rejects an unknown
`assetId`, rejects duplicate `(assetId, view)` pairs, and rejects
`view: "front-quarter"` — that view is always photographed. `model` and
`generatedAt` are provenance only and never reach the compositor. Do not edit
the file by hand; run the script.

## Cost and review

One run over the demo catalog is 28 images. At `quality=high` that is an order
of magnitude of a few US dollars; check current image pricing before running it
over a real catalog, and use `--dry-run` first to see exactly how many jobs a
run will make. Generated views are ordinary committed assets: look at each one
before committing it, and delete both the WebP and its manifest entry if the
model changed the product's design, materials, or proportions. `pnpm test:e2e`
audits every manifest view in the browser (dimensions and a real alpha channel),
so a bad entry fails the suite.

## Running it over your own catalog

1. Put your transparent 3/4 cutouts in `public/demo/photo/products/` and
   register them in `src/features/photo/photo-assets.ts` with their intrinsic
   size and bottom anchor.
2. Make sure each asset's category is in `PHOTO_ASSET_TYPES`, since the symmetry
   class decides which views are generated.
3. `cp .env.example .env.local`, set `GEMINI_API_KEY` or `OPENAI_API_KEY`.
4. `pnpm assets:products --dry-run`, then `pnpm assets:products`, for the
   products that have no cutout at all.
5. `pnpm assets:views --dry-run`, then `pnpm assets:views`.
6. Review the new WebPs, run `pnpm test && pnpm typecheck && pnpm lint`, and
   commit the images together with the regenerated manifest modules.
