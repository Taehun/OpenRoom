# OpenRoom Catalog Expansion Design

Date: 2026-09-04. Status: approved direction (owner: two new categories —
side table and bookshelf/storage — at least five products per category;
product cutouts generated with Gemini, key in `.env.local`; real Shopify
integration deferred but the current integration must be bug-free).

## 1. Outcome

The demo catalog grows from six categories × three products (18) to eight
categories × at least five products (40+). Two new object types join the Scene
model: `side_table` (a small table that stands beside a sofa or chair, in the
lamp's role) and `bookshelf` (a tall unit that backs onto a wall, in the plant's
perimeter role). Every new product ships with a photographed-looking
front-quarter cutout produced offline by the asset pipeline through Gemini's
image model, registered with a measured floor anchor and a front vector, so it
renders, mirrors, and arranges like the existing 24. Nothing at runtime changes
its shape: no key, no generation, no network.

## 2. Governing Invariants

- Runtime stays cached and offline (spec facing-views §2, §9.4): the app never
  imports `scripts/`; generation is developer-run; the key lives only in
  `.env.local`; CI never generates.
- The WebMCP surface stays exactly the Core 6; `search_products` keeps its
  contract, with `category` accepting the two new values and `limit` unchanged.
- The placement solver stays pure, deterministic, ≤ 48 candidates per object,
  beam 32, under 16 ms p95 on a production build, and never rotates an object
  beyond its truthful views.
- Existing products, ids, prices, cutouts, anchors, and the pinned seed
  composition (spec facing-views §8.5) do not change.
- Commerce stays token-free and server-free.

## 3. New Categories

| type         | dimensions (w×h×d m) | symmetry     | placement role                              | id prefix |
|--------------|----------------------|--------------|---------------------------------------------|-----------|
| `side_table` | 0.45 × 0.55 × 0.45   | `radial`     | accessory: beside a sofa end or a chair     | `side`    |
| `bookshelf`  | 0.90 × 1.80 × 0.35   | `front-back` | perimeter: backs onto a wall, faces inward  | `shelf`   |

`SceneObjectTypeSchema` and `ProductCategorySchema` gain both values (before
`unknown`). `CATEGORY_DIMENSIONS`, `ID_PREFIX`, the rail labels, the inspector
category copy, `VISUAL_WIDTH_BOUNDS` (`side_table` [5, 26], `bookshelf`
[8, 34]), `CONTACT_SHADOW_PROFILES` (`side_table` 0.6/0.5/0.19, `bookshelf`
0.8/0.35/0.2), and `PHOTO_VIEW_SYMMETRY` are extended. The seed room does not
gain new objects; new categories appear through `replace_object` is impossible
(category mismatch), so the human catalog panel and `search_products` are the
routes in, and a product of a new category can be added to the scene only by a
future "add object" flow — out of scope. **Therefore the demo exposes the new
categories through search and the catalog panel today, and they become
placeable when an add-object flow exists.** The solver, projection, and view
code still support them fully so that flow needs no further schema work.

## 4. Placement Rules

- `side_table` is an accessory (`isAccessory`), scored like the lamp: adjacency
  to a sofa end or a chair side (edge gap 0.05–0.25 m, within the seat's depth
  band) replaces the foreground term; candidates come from the sofa-end family
  and the perimeter ring. It never enters the seating hull.
- `bookshelf` is a perimeter object: candidates are wall sweeps (like the
  sofa's) restricted to walls without an opening clearance overlap, rotation
  chosen so its front faces the room centre (options come from the view table:
  `front-back` symmetry gives {0, ±45°, ±135°, 180°}); scored by wall proximity
  (accessories term) and the foreground term; hard constraints as any non-rug
  footprint.
- Both types are movable and lockable like the others; `unknown` handling is
  unchanged.

## 5. Catalog

Products (all demo prices in USD, mock data, coherent with the three style
families Japandi / modern organic / mid-century). Five per new category and two
more per existing category (so every category has five):

- `side_table` (5): oak drum side table, travertine cube, black steel tray
  table, walnut pedestal, rattan nesting side table.
- `bookshelf` (5): oak ladder shelf, walnut low credenza-height shelf, white
  oak cube storage, black steel-and-ash étagère, hinoki open bookcase.
- `sofa` +2, `coffee_table` +2, `rug` +2, `floor_lamp` +2, `chair` +2, `plant`
  +2 — each with distinct color/material/style tags.

Each product needs: id (kebab), variantId `demo-variant-<id>`, title,
category, price, dimensionsCm, styleTags (≥ 2), color, material, description
(≤ 500 chars). Dimensions stay inside the category envelope so the solver's
profiles hold.

## 6. Product Cutout Generation (pipeline mode)

`pnpm assets:products [--dry-run] [--product <id>]... [--force]` is a second
mode of the existing script (`scripts/openroom-assets/generate-products.ts`,
pure parts in `product-jobs.ts`), producing the **front-quarter** cutout for
every catalog product that has no registered asset:

- Provider adapter interface `ImageProvider { name; generate(request):
  Promise<Uint8Array> }` with two implementations: `openai` (the existing
  images/edits path, reused for views) and `gemini` — the Interactions API:
  `POST https://generativelanguage.googleapis.com/v1beta/interactions` with
  headers `x-goog-api-key: <GEMINI_API_KEY>` and `Content-Type:
  application/json`, body `{ model, input: [ {type:"text", text}, …optional
  {type:"image", mime_type, data(base64)} ], response_format: { type:"image",
  mime_type:"image/png", aspect_ratio: "3:2" | "2:3" } }`; the response's first
  image output (`output_image.data`, base64 PNG — the shell reads the first
  output item whose type is `image`) is the result. Default model
  `gemini-3.1-flash-image` (env `OPENROOM_IMAGE_MODEL_GEMINI`); provider chosen
  by `OPENROOM_IMAGE_PROVIDER` (`gemini` | `openai`; default `gemini` when
  `GEMINI_API_KEY` is set and `OPENAI_API_KEY` is not). 429/5xx retried three
  times (2 s, 4 s, 8 s) like the OpenAI path; the key is never logged.
- Gemini returns an opaque image, so the shell removes the background: pixels
  within a tolerance of the corner colour (sampled from the four corners,
  tolerance 18/255 per channel, flood-filled from the borders so interior
  whites survive) become transparent; then the alpha is feathered by one
  pixel. The prompt asks for a pure white studio background, three-quarter
  view turned to the viewer's right, whole product visible with margin,
  standing on an invisible floor, no props, no text, no shadow. Aspect
  ratio 3:2 for wide categories (sofa, coffee_table, rug, bookshelf, chair),
  2:3 for tall/narrow ones (floor_lamp, plant, side_table); the returned PNG's
  own pixel size is recorded as the intrinsic size.
- Anchor measured exactly as for views; rugs additionally need a `floorQuad`
  — rugs generated here get a default quad from the alpha bounding box
  (bottom-left/right and top-left/right of the opaque region), recorded in the
  manifest and flagged `quadSource: "bbox"`.
- Output `public/demo/photo/products/<id>.webp` (lossless WebP), manifest
  `src/features/photo/photo-products.generated.ts` exporting
  `GENERATED_PRODUCT_ASSETS: GeneratedProductAsset[]` (`id`, `src`,
  `intrinsicWidth`, `intrinsicHeight`, `anchorX`, `anchorY`, `floorQuad?`,
  `provider`, `model`, `generatedAt`). `PHOTO_ASSETS` becomes the union of the
  hand-registered 24 and the generated entries; the inventory tests count
  `24 + generated.length`.
- Views for new products come from the existing `assets:views` mode once
  their front-quarter exists (28 + new jobs); with Gemini as provider the view
  prompt sends the reference image as an `inlineData` part.

## 7. Search and UI

- `search_products` category enum and the JSON schema gain the two values;
  `limit` max stays 3 (spec Core 6); results order stays deterministic
  (catalog order then query relevance as today).
- The catalog panel's "Find alternatives" copy per category gains two lines;
  the rail shows new-type objects with `SI` / `BS` initials when present.
- Evals: `search-side-tables` (prompt "Find a side table under $300",
  expected `search_products` with `category: "side_table"`).

## 8. Shopify Integration Review

A read-only audit (dispatched separately) lists every defect that would appear
on connecting a real store; its Critical/Important findings are fixed in this
plan's last task with regression tests, without adding a token, a server route,
or an external request.

## 9. Testing

Unit: schema enums, dimensions table, symmetry table, projection profiles,
solver rules for both types (candidates, scores, determinism, caps, p95 gate
unchanged), catalog invariants (≥ 5 per category, unique ids, envelope
dimensions), pipeline pure core (planning, prompt, Gemini request body,
background removal on a synthetic RGBA buffer, quad from bbox, manifest
render/parse), provider selection from env, search results for new categories.
E2E: `photo-assets.spec.ts` audits `26 + generated views + generated products`;
`webmcp-core.spec.ts` searches a new category. Full gate before completion.

## 10. Acceptance

1. Eight categories, every one with ≥ 5 products; all ids unique; tests pin it.
2. `pnpm assets:products --dry-run` lists every product without a registered
   asset (22+ today) with no network; with `GEMINI_API_KEY` it produces
   registered, anchored, transparent cutouts and the manifest.
3. Solver and compositor accept `side_table` and `bookshelf` objects with the
   rules of section 4; p95 gate unchanged.
4. Shopify audit Critical/Important findings fixed with tests.
5. All gates pass.
