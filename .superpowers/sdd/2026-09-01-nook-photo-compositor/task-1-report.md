# Task 1 report: Pure Photo Projection and Calibration

## Implementation

- Added the versioned `NOOK_PHOTO_CALIBRATION` record with the exact pinned floor corners, floor Y values, and scale range.
- Added DOM/React-free `projectRoomPoint` and `unprojectStagePoint` functions using clamped depth and horizontal interpolation over the calibrated floor span.
- Added `objectVisualWidth` with the required `8..58` percent clamp and `layerOrder` with a 100-unit rug bias.
- Used `Pick<Scene["room"], "width" | "depth">` and the canonical `ProductCategory` type; no replacement room schema was introduced.
- Added focused tests for center inversion, calibrated corners, pointer clamping, rug ordering, and visual-width bounds.

## Next.js guide notes

Read the three pinned local Next 16.3.3 guides before editing. The relevant rules are:

- Server Components are the default; use a Client Component boundary only when state, event handlers, lifecycle logic, or browser APIs are needed. These pure projection modules have no such dependency.
- CSS Modules use `.module.css` files imported by components in the `app` directory. Task 1 creates no CSS or component files.
- Vitest supports synchronous Server and Client Component unit tests; these tests are pure synchronous unit tests and require no component environment beyond the project test setup.

## RED

Command:

```text
pnpm exec vitest run tests/unit/photo-projection.test.ts
```

Output:

```text
 RUN  v4.1.11 /Users/taehun/Projects/WebMCP/.worktrees/photo-compositor

 ❯ tests/unit/photo-projection.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/photo-projection.test.ts [ tests/unit/photo-projection.test.ts ]
Error: Failed to resolve import "../../src/features/photo/photo-calibration" from "tests/unit/photo-projection.test.ts". Does the file exist?
[90m ❯ TransformPluginContext._formatLog node_modules/.pnpm/vite@8.2.2_@types+node@24.13.3_esbuild@0.28.1_jiti@2.7.0_terser@5.51.2/node_modules/vite/dist/node/chunks/node.js:31147:18[39m
[90m ❯ TransformPluginContext.error node_modules/.pnpm/vite@8.2.2_@types+node@24.13.3_esbuild@0.28.1_jiti@2.7.0_terser@5.51.2/node_modules/vite/dist/node/chunks/node.js:31144:18[39m
[90m ❯ normalizeUrl node_modules/.pnpm/vite@8.2.2_@types+node@24.13.3_esbuild@0.28.1_jiti@2.7.0_terser@5.51.2/node_modules/vite/dist/node/chunks/node.js:28083:20[39m
[90m ❯ loadAndTransform node_modules/.pnpm/vite@8.2.2_@types+node@24.13.3_esbuild@0.28.1_jiti@2.7.0_terser@5.51.2/node_modules/vite/dist/node/chunks/node.js:20671:12[39m

[31m⎯⎯⎯⎯⎯⎯[1/1]⎯[39m

 Test Files  0 passed (1)
 Tests  0 passed (0)
 Start at 14:55:01
 Duration 560ms (transform 8ms, setup 71ms, import 0ms, tests 0ms)
```

The failure was the expected missing-module failure before production implementation.

## GREEN and verification

Focused test command:

```text
pnpm exec vitest run tests/unit/photo-projection.test.ts
```

Output:

```text
 RUN  v4.1.11 /Users/taehun/Projects/WebMCP/.worktrees/photo-compositor

 Test Files  1 passed (1)
 Tests  5 passed (5)
```

Typecheck command:

```text
pnpm run typecheck
```

Output:

```text
> nook@0.1.0 typecheck /Users/taehun/Projects/WebMCP/.worktrees/photo-compositor
> tsc --noEmit
```

`git diff --check` completed successfully with no output.

## Self-review

- Projection clamps room coordinates to the room bounds before interpolation.
- Inversion clamps normalized pointer coordinates and derives depth from calibrated floor Y values, then uses the matching interpolated floor span.
- Center projection round-trips to the room origin, and corner projections use the pinned calibration endpoints.
- No React, DOM, browser API, or CSS dependency is present.
- The implementation stays within Task 1 files and uses the canonical exported scene types.

## Concerns

None identified for Task 1. The visual-width conversion factor is intentionally a simple deterministic percent mapping because the required contract only specifies the clamped output bounds.
