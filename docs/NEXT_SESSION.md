# Nook Next Session Handoff

Snapshot: 2026-09-01 KST. Scene Core implementation commit: `55b0f9c`.

## Current State

- Feature branch: `feat/scene-core`
- Worktree: `/Users/taehun/Projects/WebMCP/.worktrees/scene-core`
- Base branch: `main` at the original fork point `9eb00b4`
- The feature worktree and `main` were clean at session wrap.
- Scene Core is committed locally but has not been merged or pushed.
- Verified baseline: 30 Vitest tests, 2 Playwright tests, typecheck, lint,
  vinext build, Next.js build, and diff check passed.

Implemented behavior includes validated Scene JSON, deterministic room
generation, revision-aware commands, Zustand history/undo/reset, an editable R3F
room, object selection, Move/Rotate TransformControls, fixture product
replacement, deterministic Agent lamp movement, and local cart approval UI.

## First Action

Resolve how to integrate `feat/scene-core` before starting another feature:

1. Recommended: merge it into `main` locally and rerun the full verification
   matrix on the merged result.
2. Alternatively, push the branch and open a pull request.

Do not delete the worktree until the integration choice is complete and the
merged or reviewed result is verified.

## Next Work Package: WebMCP Core 6

Goal: let a WebMCP-aware browser Agent read and modify the same Scene state used
by the human UI without introducing a separate Agent backend.

Before implementation, verify the current experimental WebMCP API and security
guidance against official Chrome documentation. Do not rely on a remembered API
shape.

Implement these tools first:

1. `get_scene`
2. `get_selection`
3. `search_products`
4. `replace_object`
5. `move_object`
6. `add_scene_to_cart`

### Required Behavior

- Feature-detect `document.modelContext`; keep the human UI working when it is
  unavailable.
- Register each tool once and unregister it on route change or unmount.
- Validate every input with narrow JSON Schema and Zod contracts.
- Return the shared structured `ToolResult` success/error envelope.
- Treat product fixture text as untrusted data.
- Route `replace_object` and `move_object` through the existing revision-aware
  Scene command layer with `expectedRevision`.
- Return safe errors for no selection, stale revision, missing object, locked
  object, and category mismatch without arbitrary mutation.
- Start `search_products` with the deterministic demo catalog; do not block the
  WebMCP proof on Shopify.
- `add_scene_to_cart` must only create a draft and open the visible approval
  sheet. It must not perform an external cart write before explicit user click.
- Avoid a generic `execute({ action, params })` escape hatch.

### Expected Files

```text
src/webmcp/tool-result.ts
src/webmcp/tool-contracts.ts
src/webmcp/register-tools.ts
src/webmcp/use-webmcp-tools.ts
tests/unit/tool-contracts.test.ts
tests/evals/webmcp-journeys.json
```

Keep handlers thin. `ToolContext` should expose Scene reads, selection, command
application, product search, asset resolution, and cart approval callbacks rather
than importing UI components or mutating Three.js objects.

### Verification Gate

- Exact Core 6 names register without duplicates.
- Schemas reject additional properties and out-of-range values.
- Read-only and untrusted-content annotations match the tool behavior.
- Tool handlers return structured success and error results.
- “Replace this table with the second result” changes the selected Scene object
  through WebMCP and increments the revision once.
- A stale move returns a revision conflict and the latest revision.
- “Add everything new to cart” opens approval UI with no external request.
- Cleanup removes all registered handlers.
- Existing human selection, transform, replacement, undo, reset, and cart E2E
  remain green.

Run at minimum:

```bash
pnpm run test
pnpm run test:e2e
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run build:next
git diff --check
```

## After WebMCP Core

1. Implement `CommerceProvider`, `DemoProvider`, and `ShopifyProvider` plus the
   approved cart route. Keep DemoProvider as the deterministic fallback.
2. Implement cached product assets, R2/D1 bindings, and then the optional Tripo
   live-generation showcase.
3. Add room upload/analysis only after the shared Scene, Agent, and commerce
   journey is green.

## Known Residuals

- Three/drei currently emits an upstream `THREE.Clock` deprecation warning;
  browser verification captured zero application console errors.
- Real TransformControls drag/release was manually verified in Chromium, while
  automated coverage currently tests the store transaction and browser journey
  rather than pixel-coordinate dragging.
- vinext reports a client chunk larger than 500 kB because of the 3D stack; track
  it during asset/performance work without changing locked dependencies before
  the submission.
- Aggregate `verify:fast` and `verify:full` package scripts may be added after
  Scene Core is merged, but are not required for the next feature.
