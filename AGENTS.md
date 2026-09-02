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
