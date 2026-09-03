# OpenRoom Catalog Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `side_table` and `bookshelf` to the Scene model, grow the catalog to eight categories with at least five products each, generate the new products' cutouts offline through Gemini, and close the Shopify audit's findings.

**Architecture:** Schema and category tables first (Task 1) so every later file compiles; then the catalog data (Task 2); then the pipeline's product-cutout mode with a provider adapter (Task 3); then solver/projection/view support for the two types (Task 4); then the Shopify fixes (Task 5). Generation itself runs only when the owner's key is present and is a separate, owner-triggered step after Task 3.

**Tech Stack:** Next 16.3.3, React 19, Zod 4, Vitest 4, Playwright 1.62, tsx, sharp (dev), pnpm 10.27.0, Node 24.13.1.

**Spec:** `docs/superpowers/specs/2026-09-04-openroom-catalog-expansion-design.md`

## Global Constraints

- Runtime stays cached and offline; the app never imports `scripts/`; keys only in `.env.local`; CI never generates (spec 2).
- Core 6 unchanged; `search_products` keeps `limit ≤ 3`; schemas `.strict()`.
- Solver: pure, deterministic, ≤ 48 candidates, beam 32, < 16 ms p95 production; never beyond truthful views.
- Existing 18 products, 24 cutouts, anchors, and the pinned seed composition unchanged (spec 2).
- New types: `side_table` 0.45×0.55×0.45 m, radial, prefix `side`, accessory; `bookshelf` 0.90×1.80×0.35 m, front-back, prefix `shelf`, perimeter (spec 3). Projection: `side_table` width bounds [5, 26], shadow 0.6/0.5/0.19; `bookshelf` [8, 34], 0.8/0.35/0.2.
- Gemini: Interactions API `POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key`, body `{ model, input: [...], response_format: { type: "image", mime_type: "image/png", aspect_ratio } }`, default model `gemini-3.1-flash-image`, env `GEMINI_API_KEY`, `OPENROOM_IMAGE_PROVIDER`, `OPENROOM_IMAGE_MODEL_GEMINI`; aspect 3:2 wide / 2:3 tall (spec 6).
- Repository workflow (AGENTS.md); port 3000 is the owner's; E2E in this worktree on port 3500 with `PLAYWRIGHT_BASE_URL`/`PLAYWRIGHT_SKIP_WEBSERVER=1`; never git amend/rebase/reset/stash; stage own paths.

---

### Task 1: Schema, category tables, symmetry, projection profiles

**Files:**
- Modify: `src/features/scene/scene-schema.ts` (`SceneObjectTypeSchema`, `ProductCategorySchema` gain `side_table`, `bookshelf` before `unknown`)
- Modify: `src/features/room/room-engine.ts` (`CATEGORY_DIMENSIONS`, `ID_PREFIX`)
- Modify: `src/features/photo/photo-views.ts` (`PHOTO_VIEW_SYMMETRY`), `src/features/photo/photo-projection.ts` (`VISUAL_WIDTH_BOUNDS`, `CONTACT_SHADOW_PROFILES`)
- Modify: `src/features/demo/room-canvas.tsx` (rail labels/initials `SI`, `BS`), `src/features/demo/context-panel.tsx` (category copy: `side_table: "Side tables for your room"`, `bookshelf: "Bookshelves and storage for your room"`)
- Modify: `src/webmcp/tool-contracts.ts` (`SEARCH_PRODUCTS_JSON_SCHEMA` enum), `src/webmcp/core-tool-manifest.ts` if it lists categories, `src/features/home/webmcp-guide.tsx` only if it copies the enum
- Test: `tests/unit/scene-store.test.ts` or a new `tests/unit/category-tables.test.ts`: every `SceneObjectType` except `unknown` has a dimension, a prefix, a symmetry, a width bound, a shadow profile, a rail label; `ProductCategorySchema.options` equals `SceneObjectTypeSchema.options` minus `unknown`; the search JSON schema enum equals the Zod enum.

- [ ] Write the table-completeness test (RED), extend every table, run the test and `tests/unit/tool-contracts.test.ts` (GREEN), `pnpm test && pnpm typecheck && pnpm lint`, commit `feat(scene): add side_table and bookshelf object types`.

### Task 2: Catalog data

**Files:**
- Modify: `src/features/demo/demo-data.ts` (+22 products per spec 5: 5 side tables, 5 bookshelves, +2 per existing category), `src/features/commerce/shopify-variants.ts` (no entries needed; leave), `tests/unit/photo-assets.test.ts` ("three stable products" → "at least five per category"; inventory count stays 24 + generated), `tests/evals/webmcp-journeys.json` (+ `search-side-tables`)
- Test: `tests/unit/demo-state.test.ts` or a new `tests/unit/catalog.test.ts`: ≥ 5 per category, unique ids and variantIds, every product parses with `CatalogProductSchema`, dimensions within the category envelope (±40% of `CATEGORY_DIMENSIONS`), description ≤ 500 chars, ≥ 2 style tags.

- [ ] Write the catalog invariants test (RED), add the products (coherent Japandi / modern organic / mid-century families, distinct color/material), update the eval, run tests, `pnpm test && pnpm typecheck && pnpm lint`, commit `feat(catalog): grow to eight categories with five products each`. Products without a cutout render the existing labelled fallback until Task 3's generation runs; `getPhotoAsset` returns null for them — verify no test assumes every product has an asset (`photo-assets.test.ts:200` "resolves every seed and catalog object to a checked-in file" must become "every product with a registered asset resolves to a file, and every product lacking one is listed by `productsWithoutAssets()`").

### Task 3: Product-cutout pipeline mode with a provider adapter

**Files:**
- Create: `scripts/openroom-assets/providers.ts` (`ImageProvider`, `openaiProvider`, `geminiProvider`, `selectProvider(env)`), `scripts/openroom-assets/product-jobs.ts` (pure: `planProductJobs`, `buildProductPrompt`, `geminiRequestBody`, `removeBackground(rgba, w, h)`, `quadFromAlpha`, `mergeProductManifest`, `renderProductManifestModule`, `parseProductManifestModule`), `scripts/openroom-assets/generate-products.ts` (shell with injected deps like `generate-views.ts`), `src/features/photo/photo-products.generated.ts` (`GENERATED_PRODUCT_ASSETS: GeneratedProductAsset[] = []`)
- Modify: `scripts/openroom-assets/generate-views.ts` (use `selectProvider`; Gemini view requests send the reference as an image input), `src/features/photo/photo-assets.ts` (`PHOTO_ASSETS` = hand-registered ∪ generated; `GeneratedProductAssetSchema`; `productsWithoutAssets()`), `package.json` (`assets:products`), `.env.example` (`GEMINI_API_KEY=`, `OPENROOM_IMAGE_PROVIDER=gemini`, `OPENROOM_IMAGE_MODEL_GEMINI=gemini-3.1-flash-image`), `docs/asset-views.md` (+ products mode, provider table), `AGENTS.md` (rule mentions both generated modules), `tests/e2e/photo-assets.spec.ts` (audit generated products too)
- Test: `tests/unit/product-jobs.test.ts` (planning counts the products without assets; prompt text; Gemini body shape with `x-goog-api-key` only in headers; background removal on a synthetic 12×12 buffer with a white border and a white interior pixel that must survive; quad from alpha; manifest round-trip; provider selection: gemini when only `GEMINI_API_KEY`, openai when only `OPENAI_API_KEY`, explicit override, exit 2 when neither); shell tests through `runGenerateProducts` with fake fetch: dry-run (no fetch), success (base64 PNG in `output_image.data` → decode → remove background → anchor → WebP written → manifest entry with `provider: "gemini"`), abort after a completed job, retry on 429.

- [ ] TDD as above; `pnpm assets:products --dry-run` must list 22 jobs with no network; gates; commit `feat(assets): generate product cutouts through Gemini or OpenAI`. **Never call a real API in this task.**

### Task 4: Placement, projection, and view support for the two types

**Files:**
- Modify: `src/features/placement/natural-placement.ts` (`isAccessory` includes `side_table`; `compositionContribution` gives `side_table` an adjacency term to a sofa end or chair side (edge gap 0.05–0.25 m, 0.5 m range) replacing foreground; `bookshelf` candidates: wall sweeps on walls whose clearance zones it does not overlap, rotation from options facing the room centre, scored by `accessoryContribution` + foreground; `candidatesFor` switch gains both cases; `SEATING_TYPES` unchanged), `src/features/scene/natural-placement-command.ts` (movable set includes the new types), `src/features/photo/photo-views.ts` (radial `side_table` → current rotation only; `bookshelf` front-back options)
- Test: `tests/unit/natural-placement.test.ts`: a scene with a side table beside the sofa scores higher than one mid-floor; a bookshelf is proposed against a clearance-free wall facing inward with a rotation from its options; caps and determinism hold; p95 gate untouched (E2E run once on a production build).

- [ ] TDD; gates incl. `photo-compositor.spec.ts` on a production build on port 3500; commit `feat(placement): stage side tables and bookshelves`.

### Task 5: Shopify audit fixes

**Files:** as named by the audit report (`.superpowers/sdd/2026-09-04-openroom-catalog-expansion/shopify-audit.md`, copied there by the controller) — typically `src/features/commerce/shopify-cart.ts`, `commerce-config.ts`, `shopify-variants.ts`, `cart-approval-sheet.tsx`, their tests, `tests/e2e/commerce/shopify-checkout.spec.ts`, README.
- [ ] For every Critical/Important finding: failing test → fix → test; no token, no server route, no external request; gates; commit `fix(commerce): close the Shopify integration audit findings`.
