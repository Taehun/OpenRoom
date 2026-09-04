<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Repository workflow

- Use `pnpm`; the supported runtime versions are recorded in `package.json` and `.node-version`.
- Application routes live in `app/`. Domain code lives in `src/features/`; WebMCP contracts, registration, and handlers live in `src/webmcp/`.
- Keep WebMCP contracts, handlers, registration, unit tests, and `tests/evals/webmcp-journeys.json` aligned when changing a tool.
- During implementation, run the narrowest relevant Vitest file first. Before completion, run `pnpm test`, `pnpm typecheck`, and `pnpm lint` once.
- Run `pnpm build` or `pnpm build:next` only for build/runtime changes, and `pnpm test:e2e` only for browser-visible flows.
- Never deploy, call live providers, or perform external cart writes unless the user explicitly requests it.
- Preserve unrelated user changes and do not edit generated output in `.next/`, `dist/`, or `.vinext/`.
- When a view or facing contract changes, update the view registry (`src/features/photo/photo-views.ts`), the compositor, the solver's rotation options (`buildRotationOptions`, still exercised by the placement unit tests even though the solver is unwired from the app), the WebMCP tool contracts, the unit tests, and `tests/evals/webmcp-journeys.json` together. `scripts/openroom-assets/` is the only place that may call an image model: the app has no inference route, no key, and no runtime generation, `pnpm assets:views` and `pnpm assets:products` are developer-run and never run in CI, and `src/features/photo/photo-views.generated.ts`, `src/features/photo/photo-products.generated.ts`, and `src/features/photo/photo-silhouettes.generated.ts` (`pnpm assets:measure`) are written by those scripts rather than by hand.
- Commerce stays token-free and server-free: a build either names a store in `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` or the app is unconfigured, Shopify works through cart permalinks, per-product handle links, and the store's UCP MCP endpoint, and no access token or server cart route may be added without a new approved spec. OpenRoom issues exactly one external request — an unauthenticated `tools/list` to `/api/ucp/mcp`, only when a person presses Save in the store popover. Page load, editing, and `add_scene_to_cart` still issue none, and the E2E request assertions hold that line. When the `commerce` block of `add_scene_to_cart` changes, update `src/features/commerce/store-domain.ts`, `src/features/commerce/store-probe.ts`, `src/features/commerce/store-storage.ts`, `tool-context.ts`, `tool-handlers.ts`, the unit tests, and `tests/evals/webmcp-journeys.json` together.
