# Final review fix wave — 2026-08-31

## Scope

This wave fixes the four findings from the final review without deploying,
pushing, merging, or creating any provider resources. It preserves the project
as an initialized foundation: `/demo` remains deliberately unimplemented.

## 1. `test:e2e` ran Vitest unit tests

### Change

- Added `playwright.config.ts`, scoped to `tests/e2e`, with a deterministic
  local Next server at `127.0.0.1:3000` and the Desktop Chromium project.
- Updated `test:e2e` to explicitly select that config.
- Added `tests/e2e/home-shell.spec.ts`, a real browser smoke test of the Nook
  heading and future-facing `/demo` route.
- Ignored Playwright reports and artifacts in `.gitignore`.
- Documented the one-time `pnpm exec playwright install chromium` prerequisite
  in the README.

### Focused evidence

- **RED:** `pnpm run test:e2e -- --list` exited 1 after Playwright collected
  `tests/unit/initialization.test.ts` and imported Vitest outside its runner.
- **GREEN (collection):** `pnpm run test:e2e --list` listed exactly one test:
  `tests/e2e/home-shell.spec.ts`.
- **GREEN (runtime):** `pnpm run test:e2e` passed the single Chromium smoke
  test against the local Next server.

## 2. Vitest excluded TSX tests

### Change

- Restricted Vitest to `tests/unit/**/*.test.{ts,tsx}` so unit tests remain
  isolated while both TypeScript extensions are collected.
- Added `tests/unit/home-shell.test.tsx`, a real React Testing Library test of
  the required heading and the explicitly future-facing `/demo` link.

### Focused evidence

- **RED:** Before changing the collection, `pnpm exec vitest run
  tests/unit/home-shell.test.tsx` reported no test files and displayed the
  old `tests/**/*.test.ts` include pattern.
- **GREEN:** The focused TSX command passed. `pnpm run test` then passed both
  unit tests.

## 3. Node and jsdom were not reproducible or compatible

### Registry decision

Registry metadata showed `jsdom@30.0.1` declares
`^22.22.2 || ^24.15.0 || >=26.0.0`, which excludes Node 24.13.1. The newest
compatible release line is `jsdom@29.1.1`, whose declared engine is
`^20.19.0 || ^22.13.0 || >=24.0.0`.

### Change

- Added exact Node 24.13.1 `engines.node` and `.node-version` baselines.
- Pinned `jsdom` to 29.1.1 and regenerated `pnpm-lock.yaml`.
- Aligned `@types/node` to `^24.0.0` (resolved to 24.13.3).
- Documented the Node baseline in the README.
- Extended the existing initialization contract only with meaningful
  runtime/toolchain assertions: package engine, Node typings major, and the
  conventional version file.

### Focused evidence

- **RED:** `pnpm exec vitest run tests/unit/initialization.test.ts` failed
  because `packageJson.engines` was absent.
- **GREEN:** After the pin and lockfile update, the focused initialization
  contract passed, then the full unit suite passed.

## 4. The CTA implied a live demo

### Change

- Replaced `Preview the demo` with `Deterministic demo coming soon`, retaining
  `/demo` as the future route.

### Focused evidence

- **RED:** The new real E2E test could not find the required future-facing
  link while the old CTA was present.
- **GREEN:** The same Chromium test passed after the copy changed. The TSX RTL
  test independently verifies the same user-visible contract.

## Final verification

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; lockfile up to date. |
| `pnpm run test` | Passed; 2 files, 2 tests. |
| `pnpm run test:e2e` | Passed; 1 Chromium smoke test. |
| `pnpm run typecheck` | Passed. |
| `pnpm run lint` | Passed. |
| `pnpm run build` | Passed; vinext build. |
| `pnpm run build:next` | Passed; Next Webpack compatibility build. |
| `git diff --check` | Passed. |

## Files changed

- `.gitignore`
- `.node-version`
- `README.md`
- `app/page.tsx`
- `package.json`
- `playwright.config.ts`
- `pnpm-lock.yaml`
- `tests/e2e/home-shell.spec.ts`
- `tests/unit/home-shell.test.tsx`
- `tests/unit/initialization.test.ts`
- `vitest.config.ts`

## Concerns

- Playwright smoke tests require Chromium to be installed once; the README
  gives the exact command. They bind a local Next development server, so this
  managed sandbox required the approved local execution path.
- Vinext completes successfully but retains its existing informational route
  classification notice for `/`; no build failure or unsupported API was
  reported.
- The repository contained pre-existing untracked `AGENTS.md` and `CLAUDE.md`.
  They are intentionally excluded from this fix-wave commit.
