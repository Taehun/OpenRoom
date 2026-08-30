# Nook Project Initialization Plan

## Context

This plan initializes the repository for the Nook MVP described in the user-provided product plan. The original spec path `/mnt/data/nook-mvp-plan.md` is not mounted in this environment, so the pasted product plan is the authority. This plan intentionally stops before product work package 1 (`Deterministic Scene Core`).

## Goal

Create a reproducible, Cloudflare Workers-ready Next.js 16 repository with the dependencies, quality gates, and documentation required to begin the Nook MVP work packages.

## Global Constraints

- Use Next.js 16, React 19, TypeScript, Tailwind CSS, and pnpm.
- Keep vinext as the Cloudflare Workers deployment path because the compatibility scan reported no unsupported libraries or APIs.
- Preserve the standard Next.js development path alongside vinext.
- Target desktop Chrome; do not implement mobile or product features during initialization.
- Do not add secrets or live Cloudflare, Shopify, Tripo, D1, or R2 resources.
- Pin the generated pnpm lockfile and avoid dependency upgrades after the first green build.
- The repository must remain on `feat/nook-initialization`; do not deploy, push, merge, or publish.

### Task 1 — Normalize the Next.js and vinext scaffold

**Files**

- Modify: `package.json`
- Modify: `wrangler.jsonc`
- Modify: `eslint.config.mjs`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Requirements**

- Rename the package and Worker to `nook`.
- Keep separate Next.js and vinext commands. Make `pnpm build` validate the deployable vinext build and provide a separate Webpack-based Next.js compatibility build that works in restricted environments where Turbopack cannot bind its internal port.
- Add `typecheck`, `lint`, and Cloudflare type-generation scripts.
- Ignore generated vinext/Workers output in ESLint.
- Replace template metadata and page copy with a minimal Nook project shell. Do not implement the product workspace.
- Preserve the message `The room becomes the storefront.` and link to `/demo` as the future deterministic demo route.

**Verification**

- `pnpm install --frozen-lockfile`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run build`
- `pnpm run build:next`

### Task 2 — Install the MVP development foundation

**Files**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/unit/initialization.test.ts`

**Requirements**

- Add the planned runtime foundation: React Three Fiber, Three.js, drei, Zustand, Immer, and Zod.
- Add the planned test foundation: Vitest, jsdom, React Testing Library, jest-dom, user-event, and Playwright test runner.
- Add `test`, `test:watch`, and `test:e2e` scripts without creating product behavior.
- Use TDD for the initialization contract test: first prove it fails because the expected Nook metadata/configuration is missing, then implement only what is needed for it to pass.
- The test must assert observable repository configuration, not implementation mocks.

**Verification**

- `pnpm run test`
- `pnpm run typecheck`
- `pnpm run lint`

### Task 3 — Add reproducible project documentation and safe defaults

**Files**

- Modify: `README.md`
- Create: `.env.example`
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`

**Requirements**

- Document Nook's one-line vision, initialization status, supported commands, Next/vinext split, WebMCP/browser requirement, and the fact that product work packages are not yet implemented.
- Document the required future environment variable names with empty values and default providers set to demo/cached.
- Add the MIT license.
- Add concise contribution guidance that requires tests and prohibits committed secrets or room photos.
- Do not claim a live demo, Shopify connection, Tripo generation, or WebMCP tools exist yet.

**Verification**

- `pnpm run test`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run build`
- `pnpm run build:next`

## Completion Criteria

- A clean install from `pnpm-lock.yaml` succeeds.
- Tests, type checking, linting, vinext build, and Next.js compatibility build pass.
- The repository clearly reports what is initialized and what remains unimplemented.
- No deployment or external resource mutation has occurred.
