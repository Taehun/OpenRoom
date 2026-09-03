# OpenInterior

OpenInterior is a browser-based photo compositor for exploring and furnishing
a room with deterministic catalog products.

Repository: <https://github.com/Taehun/OpenInterior> (MIT, contributions
welcome).

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

The local catalog contains exactly eighteen products: three each for sofa,
coffee table, rug, floor lamp, chair, and plant. Search order is deterministic;
the second coffee-table result remains `travertine-plinth-table`. Every seed and
product object maps to an explicit checked-in cutout asset and calibrated floor
anchor.

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

Cart operations open a visible, local approval sheet. In the default `demo`
mode the original human four-item `$626 USD` fixture and product-backed WebMCP
Scene drafts both emit no external cart write or network request. Shopify
checkout is available through cart permalinks and the store's Storefront MCP
endpoint, with no server route, no access token, and no request made by
OpenInterior itself; see [Commerce integration](#commerce-integration). A
localhost MCP companion (`pnpm mcp:openinterior`) serves the same Core 6 over
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
| ChatGPT Work and Codex in the ChatGPT desktop app's browser | Native WebMCP through `document.modelContext` | Open OpenInterior. Nothing else. |
| Any other Chromium browser exposing `document.modelContext` | Native WebMCP | Open OpenInterior. Nothing else. |
| Claude Desktop | Local MCP companion over stdio | `pnpm mcp:openinterior`, then pair the page. See [docs/local-mcp.md](docs/local-mcp.md). |
| Claude Code | Local MCP companion over stdio | Same. |
| Codex CLI | Local MCP companion over stdio | Same. |
| Claude for Chrome | Not supported as a WebMCP site-tool surface | Anthropic documents it as browser automation, not WebMCP site-tool discovery. Use the companion. |
| Browsers with no `document.modelContext` | No agent path | The complete human editor still works. |

Cart semantics do not change with the surface. `add_scene_to_cart` always opens
the local approval sheet in the page, and in the default `demo` mode it makes no
external request at all — the companion relays the call, it does not perform one.

Start and verify:

```bash
pnpm dev                                                       # serve the app on :3000
pnpm mcp:openinterior                                          # start the companion on 127.0.0.1:43110
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
| Room | `public/demo/photo/openinterior-room-empty.webp` | Fixed 16:9 background for editing. |
| Reference | `public/demo/photo/openinterior-room-before.webp` | Original mismatched room reference. |
| Seed cutouts | `public/demo/photo/seed/` | Six transparent WebPs, one for each canonical object. |
| Catalog cutouts | `public/demo/photo/products/` | Eighteen transparent WebPs, three per category. |
| Calibration | `src/features/photo/photo-calibration.ts` | Maps room `x/z` to stable stage coordinates. |
| Projection | `src/features/photo/photo-projection.ts` | Produces perspective scale, width, and layer order. |
| DOM stage | `src/features/photo/room-photo-stage.tsx` | Six semantic controls; preview then exactly-one commit. |
| Asset registry | `src/features/photo/photo-assets.ts` | Explicit dimensions and bottom-anchor metadata. |

The photo inventory is 26 WebPs total: two room images, six seed cutouts, and
eighteen catalog cutouts. `app/icon.svg` supplies the local application icon so
browser QA has no missing-resource console error.

## Prerequisites

- Node.js 24.13.1 (recorded in `package.json` and `.node-version`)
- pnpm 10.27.0 (the package manager recorded in `package.json`)
- Desktop Chrome with WebMCP support to use the Core 6 enhancement. Browsers
  without `document.modelContext` retain the complete human demo.
- No WebMCP-capable browser is needed for the local MCP companion path: Claude
  Desktop, Claude Code, and Codex CLI reach the same six tools through
  `pnpm mcp:openinterior`. See [docs/local-mcp.md](docs/local-mcp.md).

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
| `pnpm mcp:openinterior` | Start the localhost MCP companion for Claude Desktop, Claude Code, or Codex CLI. |
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
bundle. OpenInterior never needs a Shopify access token.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_COMMERCE_PROVIDER` | `demo` | `demo` keeps cart approval local with zero requests; `shopify` enables checkout on your store. |
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` | empty | Bare store host such as `your-store.myshopify.com`. Required in `shopify` mode; a missing or invalid value falls back to demo mode, recorded in `CommerceConfig` as `not-configured` or `invalid-domain`, and the approval sheet shows that reason. |
| `NEXT_PUBLIC_SHOPIFY_VARIANTS` | empty | Optional comma-separated `productId=gid://shopify/ProductVariant/<id>` pairs that override `src/features/commerce/shopify-variants.ts`. |
| `ASSET_PROVIDER` | `cached` | Assets are cached; no live generation exists. |

The remaining values in `.env.example` are reserved placeholders for future
integrations and are unused by any code today.

## Commerce integration

OpenInterior has no backend and stores no credentials. Two paths use one
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
   `merchandise_id` lines, then `get_cart` for the checkout URL. OpenInterior
   itself makes no request.

Setup:

1. Find each product's variant GID in Shopify admin (Products → variant →
   the id in the URL, or the Storefront MCP `search_catalog` tool) and record
   it in `src/features/commerce/shopify-variants.ts` or
   `NEXT_PUBLIC_SHOPIFY_VARIANTS`.
2. Set `NEXT_PUBLIC_COMMERCE_PROVIDER=shopify` and
   `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=<your-store>.myshopify.com`, then rebuild.
3. Run `pnpm run test:e2e:commerce` to exercise the Shopify-mode journey against
   a placeholder store; it stubs the store domain and makes no real request.

Demo mode remains the default and is byte-for-byte unchanged.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributions require tests where
applicable and must keep secrets and room photos out of git.

## License

MIT. See [LICENSE](LICENSE). Source and issues live at
<https://github.com/Taehun/OpenInterior>.
