# Asset views: the offline `gpt-image-1` pipeline

OpenInterior ships one photographed 3/4-view cutout per product. That view and
its mirror already show every facing within 80° of the camera, so the demo is
complete without any generated asset. The remaining views — a profile, a rear
three-quarter, and a straight back — are produced **once, offline**, by
`pnpm assets:views`, checked into `public/demo/photo/`, and registered in
`src/features/photo/photo-views.generated.ts`.

This script is the only place in the project that calls an image model. The app
has no inference route, no API key, and no runtime generation; `ASSET_PROVIDER`
stays `cached`. CI never runs the pipeline, and no test ever touches the
network.

## What it does

For every base asset that needs a view it does not have yet:

1. Reads the photographed WebP from `public/demo/photo/{seed,products}/`.
2. `POST https://api.openai.com/v1/images/edits` (multipart) with the cutout as
   `image`, the prompt below, `background=transparent`, `output_format=webp`,
   `output_compression=100`, `input_fidelity=high`, `n=1`, `quality`, and
   `size=1536x1024` for a landscape reference or `1024x1536` for a portrait one.
   HTTP 429 and 5xx are retried three times, after 2s, 4s, and 8s.
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

The demo catalog is 4 sofas + 4 chairs (3 views each) + 4 coffee tables (1 view
each) = **28 jobs**.

## Commands

```bash
pnpm assets:views --dry-run                       # print the plan, make no request
pnpm assets:views                                 # generate everything missing
pnpm assets:views --product hinoki-low-sofa       # one asset (repeatable)
pnpm assets:views --view side --view back         # one view (repeatable)
pnpm assets:views --product hinoki-low-sofa --force  # regenerate an existing entry
```

Exit codes: `0` success or dry run, `2` bad arguments or a missing
`OPENAI_API_KEY` (outside `--dry-run`), `1` a job failed — the manifest still
records the jobs that completed.

Progress goes to stdout as `[views] <assetId>/<view> ok (anchor 0.50, 0.87)`.
Env values are never printed.

## Environment

Read from `.env.local` only (via `process.loadEnvFile`, and only when the file
exists), never from `.env` and never from any bundle:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | Required outside `--dry-run`. Sent as `Authorization: Bearer …` and never logged. |
| `OPENINTERIOR_IMAGE_MODEL` | `gpt-image-1` | The image model to call. |
| `OPENINTERIOR_IMAGE_QUALITY` | `high` | `low`, `medium`, or `high`. |

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
3. `cp .env.example .env.local`, set `OPENAI_API_KEY`.
4. `pnpm assets:views --dry-run`, then `pnpm assets:views`.
5. Review the new WebPs, run `pnpm test && pnpm typecheck && pnpm lint`, and
   commit the images together with the regenerated manifest module.
