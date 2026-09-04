# OpenRoom

Photo-based room planning with WebMCP and Shopify checkout.

[![CI](https://github.com/Taehun/OpenRoom/actions/workflows/ci.yml/badge.svg)](https://github.com/Taehun/OpenRoom/actions/workflows/ci.yml)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-F38020?logo=cloudflare&logoColor=white)](https://openroom-webmcp.pages.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Live demo](https://openroom-webmcp.pages.dev/demo) · [Shopify setup](#connect-shopify) · [Local MCP setup](docs/local-mcp.md)

OpenRoom lets people arrange catalog furniture directly on a room photo. The
same scene can be edited with pointer controls or through six WebMCP tools, then
reviewed before checkout. Everything runs in the browser: there is no app
backend, no runtime image generation, and no Shopify access token.

## Highlights

- Photo compositor with move, rotate, replace, undo, reset, and support for
  placing table lamps on tables.
- Deterministic furniture catalog covering sofas, tables, rugs, lamps, chairs,
  plants, side tables, and bookshelves.
- One validated Scene store shared by the human editor, native WebMCP, and the
  local MCP companion.
- Local cart approval before any checkout action.
- Token-free Shopify checkout through cart permalinks and the store's UCP MCP
  endpoint.
- Static production deployment on Cloudflare Pages from the `main` branch.

## Quick start

Requirements: Node.js 24.13.1 and pnpm 10.27.0. Both versions are pinned in the
repository.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000/demo>. With no store domain, OpenRoom is
unconfigured: the room editor and agent tools still work locally, and the cart
offers to connect a store. No environment file is needed. `.env.example`
documents the public Shopify build defaults below and the API keys the offline
asset scripts read. Copy it to `.env.local` only when you need either.

## Connect Shopify

OpenRoom is connected when the build names a default store or a presenter uses
the store chip in the header. Both paths use only a public store domain; they do
not need an Admin API token, a Storefront API token, or a server route.

### 1. Copy the variant IDs

In Shopify Admin, open a product variant and copy the numeric ID at the end of
its URL. Match it to an OpenRoom product ID from
[`src/features/demo/demo-data.ts`](src/features/demo/demo-data.ts).

For example:

```text
OpenRoom product ID: hinoki-low-sofa
Shopify variant ID:  44352465993
```

### 2. Name the build-default store

Add these values to `.env.local` for local development, or to the Production
build environment in Cloudflare Pages:

```bash
NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
NEXT_PUBLIC_SHOPIFY_VARIANTS=hinoki-low-sofa=44352465993,oak-frame-table=44352465994
NEXT_PUBLIC_SITE_ORIGIN=https://openroom.example
```

The store domain alone turns the build's connected state on; omit it and the
app starts unconfigured. Use the bare host—no `https://` and no trailing path.
The optional variant map is a comma-separated list of
`OpenRoom product ID=Shopify variant ID` pairs; full
`gid://shopify/ProductVariant/...` values also work. `NEXT_PUBLIC_SITE_ORIGIN`
is optional and lets agents use the published UCP profile.

### 3. Rebuild

Restart `pnpm dev` locally. On Cloudflare Pages, trigger a new deployment or
push to `main` after saving the variables. These defaults are embedded in the
browser bundle at build time, so changing them does not affect an existing
deployment.

### Switch stores from the header

The store chip shows the connected domain, or **Connect a store** when neither
the build nor this browser has one. Open it, paste a store address, and press
**Save**. OpenRoom normalizes the address and sends an unauthenticated
`tools/list` request to `https://<store>/api/ucp/mcp` to confirm what cart tools
the store offers before remembering the domain in this browser. **Use the
sample store** clears that browser choice and returns to the build default.

That Save probe is the only external request OpenRoom issues. It sends no
credential; page load, room editing, product search, and `add_scene_to_cart`
remain local. A store that answers without cart tools can still be saved with a
warning because checkout and product links continue to work.

When a connected customer reviews the room:

- **Continue to Shopify** opens a cart permalink in a new tab.
- When no variant is mapped, the sheet offers per-product links on the
  connected store instead.
- Products without a variant mapping are clearly listed.
- `add_scene_to_cart` also returns `https://<store>/api/ucp/mcp`, the published
  UCP agent profile that endpoint requires, the mapped cart lines, and a handle
  link for every requested product, for agents that would rather build the cart
  themselves.
- OpenRoom stores no Shopify credentials. If no store is connected, the sheet
  offers the store chip and `add_scene_to_cart` reports `NO_STORE_CONNECTED`.

To import the demo catalog into a Shopify development store, use the checked-in
CSV or the optional Admin API seed tools described in
[`examples/shopify/README.md`](examples/shopify/README.md).

## WebMCP and agent access

OpenRoom exposes the same six tools through every supported agent path:

| Tool | Purpose |
| --- | --- |
| `get_scene` | Read the current validated scene. |
| `get_selection` | Read the selected object. |
| `search_products` | Search the local catalog. |
| `replace_object` | Replace an object with a catalog product. |
| `move_object` | Move or turn an object. |
| `add_scene_to_cart` | Open the local cart approval sheet. |

- **Native WebMCP:** open OpenRoom in a browser that provides
  `document.modelContext`; the tools register automatically.
- **Claude Desktop, Claude Code, or Codex CLI:** register the localhost MCP
  companion, then pair it with the open page using its six-digit code. See
  [the local MCP guide](docs/local-mcp.md).
- **Other browsers:** the full pointer and keyboard editor still works without
  an agent connection.

The native and companion paths share the same tool manifest, validation,
handlers, scene history, and visible approval flow.

## How it is built

| Area | Implementation |
| --- | --- |
| App | Next.js 16, React 19, and TypeScript |
| Scene state | Zustand command/history store in [`src/features/scene/`](src/features/scene/) |
| Photo compositor | Semantic DOM layers in [`src/features/photo/`](src/features/photo/) |
| WebMCP | Contracts, registration, and handlers in [`src/webmcp/`](src/webmcp/) |
| Commerce | Static variant mapping and cart permalinks in [`src/features/commerce/`](src/features/commerce/) |
| Deployment | Static export on Cloudflare Pages (`pnpm build:pages` → `out`) |

Furniture cutouts and alternate views are checked-in assets. Optional image
generation is developer-run only, never part of the app or CI. See
[`docs/asset-views.md`](docs/asset-views.md).

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Next.js development server on port 3000. |
| `pnpm test` | Run the Vitest unit and integration suite. |
| `pnpm typecheck` | Type-check without emitting files. |
| `pnpm lint` | Run ESLint. |
| `pnpm test:e2e` | Run the demo Playwright journeys. |
| `pnpm test:e2e:commerce` | Run connected-store journeys against a stubbed store. |
| `pnpm build:pages` | Create the static Cloudflare Pages output in `out/`. |
| `pnpm build` | Build the vinext Worker target. Unused by the deployment; kept for runtime compatibility checks. |
| `pnpm build:next` | Run the standard Next.js compatibility build. |
| `pnpm mcp:openroom` | Start the local MCP companion manually for debugging. |

Additional catalog and offline asset commands are documented in their
respective guides rather than run during a normal build.

## Cloudflare Pages deployment

The production site is [openroom-webmcp.pages.dev](https://openroom-webmcp.pages.dev).
Cloudflare Pages is connected directly to this GitHub repository and deploys
every push to `main`. Other branches and pull requests can use preview
deployments.

Use these Pages build settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `pnpm build:pages` |
| Build output directory | `out` |
| Node.js | `24.13.1` |

The Shopify build defaults above belong in the Pages **build environment**,
because Next.js inlines `NEXT_PUBLIC_*` values while building. A store selected
with the header chip is browser-local and needs no deployment or Cloudflare
runtime binding.

GitHub Actions only checks: type checking, linting, Vitest, both Playwright
smoke suites, and both builds. Deployment belongs to Cloudflare Pages' own Git
integration, so no workflow holds a Cloudflare token. Pages is the only
deployment target — the Worker that once served the site has been deleted —
and any metadata route added later must carry
`export const dynamic = "force-static"` or the export fails.

## Project layout

```text
app/                         Routes and global UI
src/features/                Scene, photo, demo, and commerce domain code
src/webmcp/                  WebMCP contracts, registration, and handlers
src/local-mcp/               Browser side of the local MCP relay
scripts/openroom-mcp/        Local MCP companion
scripts/openroom-assets/     Offline asset pipelines
tests/                       Unit, integration, evaluation, and browser tests
examples/shopify/            Optional Shopify catalog import and seed tools
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Keep WebMCP contracts, handlers, tests,
and evaluation journeys aligned when changing a tool. Never commit credentials
or personal room photos.

## License

[MIT](LICENSE)
