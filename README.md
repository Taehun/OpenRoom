# Nook

Nook is a browser-based way to explore and furnish a room with interactive 3D products.

## Status

The project foundation is initialized: it uses Next.js 16, React 19, TypeScript,
pnpm, Vitest, and a vinext runtime target for Cloudflare Workers. This repository
does **not** yet include product work packages for the 3D scene, WebMCP tools,
provider integrations, or cart behavior. There is no live demo and no working
Shopify, Tripo, Room AI, or WebMCP integration yet.

## Prerequisites

- Node.js 24.13.1 (recorded in `package.json` and `.node-version`)
- pnpm 10.27.0 (the package manager recorded in `package.json`)
- Desktop Chrome with WebMCP support for future WebMCP work; other browsers or
  environments may be useful for general development but do not satisfy that
  requirement.

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
