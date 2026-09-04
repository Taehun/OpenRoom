# OpenRoom

AI room planner and furniture shopping

[![CI](https://github.com/Taehun/OpenRoom/actions/workflows/ci.yml/badge.svg)](https://github.com/Taehun/OpenRoom/actions/workflows/ci.yml)

OpenRoom is a browser-based photo compositor for exploring and furnishing
a room with deterministic catalog products.

Repository: <https://github.com/Taehun/OpenRoom> (MIT, contributions
welcome). Live demo: <https://openroom.taehun.workers.dev> (deployed from
`main` by CI).

## Status

The project uses Next.js 16, React 19, TypeScript, pnpm, Vitest, Playwright, and
a vinext runtime target for Cloudflare Workers. `/demo` has a centered 16:9 DOM
photo stage over a checked-in empty-room background. Six labelled transparent
cutout controls share the stage with a retained six-item object rail, inspector,
Move/Rotate tools, undo, reset, prompt guidance, and cart approval. There is no
WebGL canvas or generic agent tool; Three.js, React Three Fiber, and Drei have
been removed from the runtime and lockfile.

Human pointer/keyboard transforms and native WebMCP operations use the same
validated Scene JSON and Zustand command/history store. A successful replace or
move commits one command and increments `Scene.revision` once. Actual selection
changes, successful commands, undo, and reset increment the monotonic
`stateVersion`; native mutations must carry the latest revision and state
version. Stale requests return `SCENE_REVISION_CONFLICT` without changing Scene
data or DOM placement. A pointer drag previews locally and commits once on
release, while undo restores the exact previous coordinate and projected visual
placement.

The local catalog holds 43 products across eight categories — sofa, coffee
table, rug, floor lamp (including three table lamps that can stand on a table),
chair, plant, side table, and bookshelf — with at least five per category.
Search order is deterministic; the second coffee-table result remains
`travertine-plinth-table`. Every seed and product object maps to an explicit
checked-in cutout asset, a calibrated floor anchor, and a measured silhouette.

WebMCP Core 6 is a feature-detected progressive enhancement registered through
`document.modelContext.registerTool`: `get_scene`, `get_selection`,
`search_products`, `replace_object`, `move_object`, and `add_scene_to_cart`.
Descriptors use `(input, { signal })`, validate catalog output, mark possible
catalog text as untrusted, and are aborted when `/demo` unmounts. Browsers
without native WebMCP retain the complete human editor. The prompt area only
copies guidance for an active agent surface; it does not execute a model in the
page. Native `document.modelContext` is expected to be injected for the
document lifetime before React mounts. The current platform exposes no
post-mount availability event, so this package intentionally does not poll,
monkey-patch, or dynamically re-register; unsupported documents keep the human
editor.

Cart operations open a visible, local approval sheet, and the sheet is always
the room: the header's View cart button and `add_scene_to_cart` build the same
draft from the room's product-backed objects, so a room holding no catalog
product opens an honest empty state instead of a fixture. In the default `demo`
mode approving emits no external cart write or network request. Shopify
checkout is available through cart permalinks and the store's Storefront MCP
endpoint, with no server route, no access token, and no request made by
OpenRoom itself; see [Commerce integration](#commerce-integration). A
localhost MCP companion (`pnpm mcp:openroom`) serves the same Core 6 over
stdio to Claude Desktop, Claude Code, and Codex CLI by relaying each call to one
explicitly paired browser page; see
[Agent surface compatibility](#agent-surface-compatibility) and
[docs/local-mcp.md](docs/local-mcp.md). Tripo/R2/D1 integrations, upload,
analysis, persistence, and server-side cart writes remain future work.

## Agent surface compatibility

There is one manifest (`src/webmcp/core-tool-manifest.ts`) and one live browser
Scene. Both paths register the same six tool names, descriptions, and input JSON
Schemas, and both execute the same `createCoreTools(context)` descriptors against
the same Zustand store, so a tool behaves identically whichever way it is
reached. `tests/e2e/webmcp-core.spec.ts` asserts that parity.

| Agent surface | How it reaches Core 6 | Setup |
| --- | --- | --- |
| ChatGPT Work and Codex in the ChatGPT desktop app's browser | Native WebMCP through `document.modelContext` | Open OpenRoom. Nothing else. |
| Any other Chromium browser exposing `document.modelContext` | Native WebMCP | Open OpenRoom. Nothing else. |
| Claude Desktop | Local MCP companion over stdio | Register the companion with the client — the client starts it — then pair the page with the six-digit code it logs. See [docs/local-mcp.md](docs/local-mcp.md). |
| Claude Code | Local MCP companion over stdio | Same. |
| Codex CLI | Local MCP companion over stdio | Same. |
| Claude for Chrome | Not supported as a WebMCP site-tool surface | Anthropic documents it as browser automation, not WebMCP site-tool discovery. Use the companion. |
| Browsers with no `document.modelContext` | No agent path | The complete human editor still works. |

Chromium exposes `document.modelContext` from version 146, but until Chrome 149
it sits behind `chrome://flags/#enable-webmcp-testing`, which needs a browser
relaunch to take effect; from Chrome 149 an origin trial removes that flag
requirement. WebMCP has only been verified on Google Chrome, so other Chromium
browsers may differ. The guide at `/` detects all of this and says what to do.

Cart semantics do not change with the surface. `add_scene_to_cart` always opens
the local approval sheet in the page, and in the default `demo` mode it makes no
external request at all — the companion relays the call, it does not perform one.

Start and verify:

```bash
pnpm dev                                                       # serve the app on :3000
pnpm mcp:openroom                                              # the script the client runs; by hand only to debug
pnpm exec vitest run tests/integration/local-mcp-companion.test.ts   # real client, real process
pnpm test                                                      # unit suite plus that integration test
```

Sources: OpenAI documents site tools as ChatGPT's implementation of the proposed
WebMCP standard, discoverable by ChatGPT Work and Codex in the ChatGPT desktop
app's built-in browser (<https://learn.chatgpt.com/docs/webmcp>). Anthropic
documents local MCP connectivity for Claude Desktop and Claude Code
(<https://docs.anthropic.com/en/docs/claude-code/mcp>), while its Chrome
integration is documented as browser automation rather than WebMCP site-tool
discovery
(<https://support.anthropic.com/en/articles/12012173-getting-started-with-claude-for-chrome>).

## Photo architecture and assets

| Layer | Source | Invariant |
| --- | --- | --- |
| Room | `public/demo/photo/openroom-room-empty.webp` | Fixed 16:9 background for editing. |
| Reference | `public/demo/photo/openroom-room-before.webp` | Original mismatched room reference. |
| Seed cutouts | `public/demo/photo/seed/` | Six transparent WebPs, one for each canonical object. |
| Catalog cutouts | `public/demo/photo/products/` | Forty-three transparent cutouts, five or more per category; 25 were generated offline. |
| Calibration | `src/features/photo/photo-calibration.ts` | Maps room `x/z` to stable stage coordinates. |
| Projection | `src/features/photo/photo-projection.ts` | Produces perspective scale, width, and layer order. |
| DOM stage | `src/features/photo/room-photo-stage.tsx` | Six semantic controls; preview then exactly-one commit. |
| Asset registry | `src/features/photo/photo-assets.ts` | Explicit dimensions and bottom-anchor metadata. |

The photo inventory is 26 WebPs total: two room images, six seed cutouts, and
eighteen catalog cutouts. The application icon suite includes the scalable
browser icon and multi-resolution favicon in `app/`, an Apple touch icon, and
192px, 512px, maskable, and 1024px PNGs in `public/icons/`. `app/manifest.ts`
publishes the installable-web-app variants.

## Facing and views

Every cutout records the direction its front points in the photo
(`frontVector`), and every Scene object derives the direction its front points
in the room (`facing`) from `rotation[1]`, which stays the only stored
orientation. The compositor picks the registered view whose front vector best
matches the object's facing and mirrors left/right twins for free; it never
tilts a cutout with a CSS rotation. Rotation options offered to tooling stay
within the directions some registered view can show truthfully
(`buildRotationOptions`), and the stage marks a rendered view as approximate
when the nearest one is more than 45° off.

| Piece | Where |
| --- | --- |
| Facing math | `src/features/photo/photo-facing.ts` |
| View registry and selection | `src/features/photo/photo-views.ts` (`PHOTO_ASSET_SETS`) |
| Generated view manifest | `src/features/photo/photo-views.generated.ts` |
| Generated product cutouts | `src/features/photo/photo-products.generated.ts` |
| Offline pipelines | `scripts/openroom-assets/` (`pnpm assets:views`, `pnpm assets:products`) |

The photographed 3/4 cutout plus its mirror already covers every facing within
80° of the camera, so the demo works with an empty manifest. The missing views
(`side`, `back-quarter`, `back` for seating; `side` for coffee tables, which are
front/back symmetric; none for lamps, plants, or rugs, which are radial) are
produced once, offline, by a developer-run script:

```bash
pnpm assets:views --dry-run   # prints the 28 planned jobs, makes no request
pnpm assets:views             # needs OPENAI_API_KEY in .env.local
```

The script reads the photographed WebP, asks OpenAI `gpt-image-1` for the
missing view on a transparent background, measures the floor anchor from the
alpha channel, writes the WebP beside the original in `public/demo/photo/`, and
rewrites `photo-views.generated.ts`. It is the only place in the project that
calls an image model: the app has no inference route, no key, and no runtime
generation, and CI never runs the pipeline. A full run of the demo catalog is 28
images, an order of magnitude of a few US dollars at `quality=high`; check
current image pricing before running it over a real catalog. Generated views are
reviewed and committed like any other asset. See
[docs/asset-views.md](docs/asset-views.md).

The same directory holds a second, independent mode. `pnpm assets:products`
photographs the missing **front-quarter** cutout for every catalog product that
has no registered asset: it asks the configured provider — Gemini
(`gemini-3.1-flash-image`) by default, OpenAI when `OPENAI_API_KEY` is the key
present — for a three-quarter product shot on a pure white studio background,
removes that background by flooding in from the borders so whites inside the
product survive, feathers the alpha edge, measures the same floor anchor (plus a
bounding-box floor quad for rugs), writes a lossless WebP into
`public/demo/photo/products/`, and appends to `photo-products.generated.ts`.
`PHOTO_ASSETS` is the union of the hand-registered cutouts and the generated
ones, so a generated product is registered, audited, and composited exactly like
a photographed one.

## Prerequisites

- Node.js 24.13.1 (recorded in `package.json` and `.node-version`)
- pnpm 10.27.0 (the package manager recorded in `package.json`)
- Desktop Chrome with WebMCP support to use the Core 6 enhancement. Browsers
  without `document.modelContext` retain the complete human demo.
- No WebMCP-capable browser is needed for the local MCP companion path: Claude
  Desktop, Claude Code, and Codex CLI reach the same six tools through the
  companion, which each client starts from the command you register with it.
  See [docs/local-mcp.md](docs/local-mcp.md) for that command and for how to
  read the pair code.

## Setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
```

`.env.example` contains only safe, non-secret defaults. Keep credentials in a
local environment file; never commit them.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Next.js development server. |
| `/demo` | Open the local deterministic photo room after starting `pnpm dev`. |
| `pnpm build` | Build the vinext Cloudflare Workers target. |
| `pnpm build:next` | Run the Next.js compatibility build. |
| `pnpm start` | Start the Next.js production server. |
| `pnpm typecheck` | Type-check without emitting files. |
| `pnpm lint` | Run ESLint. |
| `pnpm test` | Run the Vitest suite once, including the companion integration test. |
| `pnpm test:watch` | Run Vitest in watch mode. |
| `pnpm test:e2e` | Run the Playwright demo-mode end-to-end tests (port 3000). |
| `pnpm test:e2e:commerce` | Run the Playwright Shopify-mode journeys (port 3001). |
| `pnpm mcp:openroom` | The localhost MCP companion for Claude Desktop, Claude Code, and Codex CLI. Your client runs this for you once the command in [docs/local-mcp.md](docs/local-mcp.md) is registered; run it by hand only to debug. |
| `pnpm assets:views` | Generate the missing cutout views offline (developer-run; needs `GEMINI_API_KEY` or `OPENAI_API_KEY`). Add `--dry-run` to only print the plan. |
| `pnpm assets:products` | Generate the missing product front-quarter cutouts offline (developer-run; same keys). Add `--dry-run` to only print the plan. |
| `pnpm cf-typegen` | Generate Cloudflare Worker types. |
| `pnpm dev:vinext` | Start vinext locally on port 3001. |
| `pnpm build:vinext` | Build the vinext Cloudflare Workers target. |
| `pnpm start:vinext` | Start the built vinext Worker with Wrangler. |
| `pnpm deploy:vinext` | Deploy the vinext Worker (only when explicitly authorized). |

## Runtime targets

`pnpm dev`, `pnpm start`, and `pnpm build:next` use the standard Next.js path.
`pnpm dev:vinext`, `pnpm build` (or `pnpm build:vinext`), and
`pnpm start:vinext` use vinext and Wrangler for the Cloudflare Workers target.
The two paths are kept so compatibility can be checked while the Worker runtime
is developed.

Before running `pnpm test:e2e`, install the project’s Chromium browser once:

```bash
pnpm exec playwright install chromium
```

`pnpm test:e2e` and `pnpm test:e2e:commerce` use separate Playwright configs and
separate dev servers, but they share the same `.next` build directory, so never
run the two concurrently.

The release verification sequence is:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run test:e2e
pnpm run test:e2e:commerce
pnpm run build
pnpm run build:next
git diff --check
git status --short
```

## Environment variables

Copy `.env.example` to `.env.local` and set only what you need. The three
commerce variables (`NEXT_PUBLIC_*`) are inlined into the client bundle at build
time: both `next build` (`pnpm build:next`) and `vinext build` (`pnpm build`)
read them from the environment that runs the build, so set them there and
rebuild to change them. `ASSET_PROVIDER` is a reserved value that nothing reads
today. Cloudflare Worker `vars` are runtime-only and never reach the client
bundle. OpenRoom never needs a Shopify access token.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_COMMERCE_PROVIDER` | `demo` | `demo` keeps cart approval local with zero requests; `shopify` enables checkout on your store. |
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` | empty | Bare store host such as `your-store.myshopify.com`. Required in `shopify` mode; a missing or invalid value falls back to demo mode, recorded in `CommerceConfig` as `not-configured` or `invalid-domain`, and the approval sheet shows that reason. |
| `NEXT_PUBLIC_SHOPIFY_VARIANTS` | empty | Optional comma-separated `productId=gid://shopify/ProductVariant/<id>` pairs that override `src/features/commerce/shopify-variants.ts`. |
| `ASSET_PROVIDER` | `cached` | Assets are cached; no live generation exists. |
| `GEMINI_API_KEY` | empty | Script-only. Read from `.env.local` by the asset pipelines; never bundled, never logged, never used by the app. |
| `OPENAI_API_KEY` | empty | Script-only. The same, for the OpenAI provider. |
| `OPENROOM_IMAGE_PROVIDER` | see below | Script-only. `gemini` or `openai`; unset picks OpenAI when `OPENAI_API_KEY` is set, otherwise Gemini. |
| `OPENROOM_IMAGE_MODEL_GEMINI` | `gemini-3.1-flash-image` | Script-only. The Gemini image model. |
| `OPENROOM_IMAGE_MODEL` | `gpt-image-1` | Script-only. The OpenAI image model. |
| `OPENROOM_IMAGE_QUALITY` | `high` | Script-only. `low`, `medium`, or `high` for the OpenAI provider. |

Those `*_API_KEY`/`OPENROOM_IMAGE_*` values are read only by
`scripts/openroom-assets/` when you run `pnpm assets:views` or
`pnpm assets:products` by hand. No runtime code path, build step, or CI job
reads them.

## Commerce integration

OpenRoom has no backend and stores no credentials. Two paths use one
static mapping from demo product ids to Shopify variant GIDs:

1. **Human checkout.** In `shopify` mode, `Continue to Shopify` in the approval
   sheet opens a cart permalink (`https://<store>/cart/<variantId>:<qty>,...`)
   in a new tab. Products without a mapping are listed as
   `Not mapped to a Shopify variant` and left out; if nothing is mapped the
   button is disabled.
2. **Agent checkout.** `add_scene_to_cart` returns `draft.commerce` with
   `lines` (`productId`, `merchandiseId`, `quantity`), `skipped`,
   `checkoutPermalink`, and `mcpEndpoint` (`https://<store>/api/mcp`). Connect
   Claude, ChatGPT, or any MCP client to that endpoint (Shopify's Storefront MCP
   needs no authentication), let it call `update_cart` with the returned
   `merchandise_id` lines, then `get_cart` for the checkout URL. OpenRoom
   itself makes no request.

Setup:

1. Find each product's variant id in Shopify admin (Products → variant → the
   numeric id at the end of the URL, or the Storefront MCP `search_catalog`
   tool) and wrap it as `gid://shopify/ProductVariant/<numeric id>` before
   recording it in `src/features/commerce/shopify-variants.ts`.
   `NEXT_PUBLIC_SHOPIFY_VARIANTS` also accepts the bare numeric id and wraps it
   for you, so `rug=44352465993` and
   `rug=gid://shopify/ProductVariant/44352465993` are equivalent; anything else
   is reported as `Not mapped to a Shopify variant` and left out of the cart.
2. Set `NEXT_PUBLIC_COMMERCE_PROVIDER=shopify` and
   `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=<your-store>.myshopify.com`, then rebuild.
3. Run `pnpm run test:e2e:commerce` to exercise the Shopify-mode journey against
   a placeholder store; it stubs the store domain and makes no real request.

To try this against a real store, seed a development store with the catalog: see
[`examples/shopify-furniture-store/README.md`](examples/shopify-furniture-store/README.md).

Demo mode remains the default and is byte-for-byte unchanged.

## CI and deployment

Two Cloudflare targets exist. The Worker (`openroom.taehun.workers.dev`) is the
primary deploy (`pnpm build && pnpm deploy:vinext`). A fully static export also
runs on Cloudflare Pages at <https://openroom-y20.pages.dev>: `pnpm build:pages`
writes `out/` (both routes are prerendered; `NEXT_OUTPUT=export` switches the Next
config to `output: "export"` with unoptimised images) and `pnpm deploy:pages`
uploads it. The `openroom.pages.dev` subdomain belongs to another account, so
the project subdomain is `openroom-y20`.


`.github/workflows/ci.yml` runs on every push and pull request to `main`:
typecheck, lint, unit and integration tests, the Playwright smoke suites
(demo and Shopify-mode journeys), and both builds (`next build` and
`vinext build`). Playwright traces are uploaded when a smoke test fails.

On a push to `main` that passes CI, the `deploy` job builds with vinext and
deploys the Worker `openroom` (static assets included) to Cloudflare with
`pnpm run deploy:vinext`, using the existing `wrangler.jsonc`. The live URL is
<https://openroom.taehun.workers.dev>.

Deployment needs two repository secrets; the job is skipped with a notice until
both exist:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account id (`pnpm exec wrangler whoami`). |
| `CLOUDFLARE_API_TOKEN` | An API token created from the **Edit Cloudflare Workers** template in the Cloudflare dashboard. |

Set them with `gh secret set CLOUDFLARE_API_TOKEN -R Taehun/OpenRoom` (paste
the token when prompted). A first deploy can also be run locally with
`pnpm run build && pnpm run deploy:vinext` after `pnpm exec wrangler login`.

Shopify mode is configured with three repository **variables** (not secrets:
`NEXT_PUBLIC_*` is inlined into the client bundle and is public anyway). The
deploy job passes them into the vinext build, and a build step then greps
`dist/client` for the store domain and fails the deploy if it is missing:

| Variable | Purpose | Example |
| --- | --- | --- |
| `NEXT_PUBLIC_COMMERCE_PROVIDER` | Selects the commerce path; anything but `shopify` keeps demo mode. | `shopify` |
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` | Bare store host the permalink and the Storefront MCP endpoint are built from. | `your-store.myshopify.com` |
| `NEXT_PUBLIC_SHOPIFY_VARIANTS` | Comma-separated `productId=variant` overrides for the static map. | `rug=44352465993,floor-lamp=gid://shopify/ProductVariant/44352465994` |

Set them with `gh variable set NEXT_PUBLIC_COMMERCE_PROVIDER -R Taehun/OpenRoom
--body shopify`. Because these values are **inlined at build time**, changing a
variable has no effect until the next deploy — a Worker runtime variable cannot
patch a bundle that was already compiled; re-run the workflow after editing one.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributions require tests where
applicable and must keep secrets and room photos out of git.

## License

MIT. See [LICENSE](LICENSE). Source and issues live at
<https://github.com/Taehun/OpenRoom>.
