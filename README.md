# Nook

Nook is a browser-based photo compositor for exploring and furnishing a room
with deterministic catalog products.

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

Cart operations open a visible, local approval sheet. The original human
four-item `$626 USD` fixture and product-backed WebMCP Scene drafts both emit no
external cart write or network request. The planned local Claude MCP companion
is not implemented in this branch. Shopify/Tripo/R2/D1 integrations, upload,
analysis, persistence, and external cart writes remain future work.

## Photo architecture and assets

| Layer | Source | Invariant |
| --- | --- | --- |
| Room | `public/demo/photo/nook-room-empty.webp` | Fixed 16:9 background for editing. |
| Reference | `public/demo/photo/nook-room-before.webp` | Original mismatched room reference. |
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
| `pnpm test` | Run the Vitest suite once. |
| `pnpm test:watch` | Run Vitest in watch mode. |
| `pnpm test:e2e` | Run Playwright end-to-end tests. |
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

The release verification sequence is:

```bash
pnpm test
pnpm run test:e2e
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run build:next
git diff --check
git status --short
```

## Environment variables

Copy `.env.example` to `.env.local` and set only the values needed for the work
you are doing. `COMMERCE_PROVIDER=demo` and `ASSET_PROVIDER=cached` are safe
defaults that avoid live-provider assumptions. The remaining provider values are
intentionally empty until their future integrations are implemented.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributions require tests where
applicable and must keep secrets and room photos out of git.

## License

MIT. See [LICENSE](LICENSE).
