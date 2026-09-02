# Nook Next Session Handoff

Snapshot: 2026-09-01 KST. Task 5 is identified by the exact commit subject
`test(photo): verify whole-room redesign journey`; a commit cannot truthfully
self-reference its own final SHA, so use `git log -1 --format='%H %s'` after
checkout.

## Current branch

- Feature branch: `feat/photo-compositor`
- Worktree: `/Users/taehun/Projects/WebMCP/.worktrees/photo-compositor`
- Base: `main` at `22e884f050b3a907a61eff065e307ec531566001`
- Pre-Task-5 HEAD: `34e532d3a4bb0fe2e8c280b841e1120a813a397f`
  (`fix(demo): restore accessible object rail`)
- Merge, rebase, push, pull-request creation, deployment, and external-provider
  calls were not performed.

## Implemented photo compositor

- `/demo` renders a real room photograph with six transparent DOM cutout
  buttons: sofa, coffee table, rug, floor lamp, chair, and plant. A separate
  six-item object rail remains available to pointer and keyboard users.
- The stage preserves the room’s 16:9 geometry at 1440×900 and 1280×800. It has
  no WebGL canvas, generic execute tool, Three.js, React Three Fiber, or Drei.
- `public/demo/photo/` contains 26 WebPs: an empty-room background, the original
  before-room reference, six seed cutouts, and eighteen product cutouts.
  `photo-assets.ts` records explicit intrinsic sizes and alpha bottom anchors;
  calibration/projection map Scene `x/z` coordinates to perspective-aware DOM
  placement and layer order.
- The deterministic catalog contains three products for each of the six
  categories. `travertine-plinth-table` remains the second coffee-table result,
  and replacing it through the captured descriptor applies exactly one Scene
  command.
- Missing assets render as labelled, selectable fallbacks. The fallback path is
  covered by the real `RoomPhotoStage` component test because normal demo data
  intentionally resolves every asset.

## Scene and command invariants

- Validated Scene JSON is the source of truth for human and native WebMCP
  operations; the DOM is a projection, not a parallel state store.
- A successful replace or move increments `Scene.revision` exactly once and is
  added to the shared history. Pointer movement remains preview-only until
  release, so one human drag commits once.
- `stateVersion` increases for real selection changes, successful commands,
  undo, and reset. Native mutations carry both latest `expectedRevision` and
  `expectedStateVersion`.
- Stale mutations return `SCENE_REVISION_CONFLICT` with latest concurrency
  tokens and change neither Scene nor cutout style.
- Undo restores the exact prior coordinate, rotation, selection, and visual
  projection. Reset restores the canonical six-object seed.

## Native WebMCP and cart boundary

- Supported ChatGPT Work/Codex browser surfaces discover exactly the Core 6 via
  `document.modelContext.registerTool`: `get_scene`, `get_selection`,
  `search_products`, `replace_object`, `move_object`, and
  `add_scene_to_cart`.
- Descriptors use `(input, { signal })`, validate and clone catalog data, mark
  possible catalog output untrusted, and abort all six registrations when the
  demo unmounts. Unsupported browsers retain the complete human editor.
- Native `document.modelContext` is expected to be injected for the document
  lifetime before React mounts. The current platform exposes no post-mount
  availability event, so this package intentionally does not poll,
  monkey-patch, or dynamically re-register; unsupported documents keep the
  human editor.
- Sequential whole-room replacement reads the latest revision/state version
  after every command and produces exactly six revision increments plus six
  product-backed, visible cutouts.
- `add_scene_to_cart` opens a six-product approval sheet for that redesigned
  Scene. Browser routing, fetch observation, and manual request inspection show
  no external cart write. The original four-item `$626 USD` human fixture is
  intentionally unchanged.
- “Copy redesign prompt” copies guidance for a real agent surface. There is no
  in-page model execution or simulated agent button.
- The local Claude MCP companion remains a separate plan in
  `docs/superpowers/plans/2026-09-01-nook-local-mcp-companion.md`; it is not
  implemented or claimed here.

## Task 5 RED / GREEN evidence

Whole-room browser journey:

```bash
pnpm exec playwright test tests/e2e/photo-compositor.spec.ts tests/e2e/webmcp-core.spec.ts tests/e2e/demo-workspace.spec.ts tests/e2e/photo-assets.spec.ts --config=playwright.config.ts
```

- RED: exit `1`; the new test first exposed a byte-level CSS serialization
  assertion that differed only in whitespace. The assertion was corrected to
  compare explicit projected CSS properties plus the independent Scene
  coordinate. The later 16:9 assertions then failed at both required viewports:
  1280×800 measured `1.4185`, and 1440×900 measured `1.4237` instead of
  `1.7778`.
- GREEN: the focused browser set passed after restoring the stage aspect ratio.
  The journey captured exact native descriptors, chose the literal second
  result in all six categories, advanced revision/state version once per
  replacement, verified six product assets in the live DOM, dragged once,
  undid exactly, rejected a stale move without side effects, opened a six-item
  approval, observed zero fetch/cross-origin requests, and verified cleanup.

Application-icon repair:

- RED: `link[rel="icon"]` was absent and headed Chrome logged a 404 for
  `/favicon.ico`.
- GREEN: `app/icon.svg` produced a versioned `/icon.svg` link and a 200 response;
  the fresh manual browser console reported 0 errors and 0 warnings.

## Browser and accessibility QA

- Headed Playwright CLI session used the installed Chrome-for-Testing binary.
- Screenshots:
  - `output/playwright/task-5-qa/room-1440x900.png`
  - `output/playwright/task-5-qa/room-1280x800.png`
  - `output/playwright/task-5-qa/focus-ring-1280x800.png`
- Both viewports showed the 16:9 stage, all six intentionally mismatched seed
  objects with coherent perspective/light direction, clean alpha edges and
  bottom anchors, the six-item rail, inspector, and prompt guidance. Selection
  kept `window.scrollY` at `0`.
- Keyboard-only traversal visibly focused controls; Move+ArrowRight changed X
  from `0.00` to `0.08` at revision 2, Rotate+ArrowRight changed Y rotation from
  `0°` to `5°` at revision 2, and Ctrl+Z restored revision 1 and exact values.
  Escape cleared selection, Reset restored the canonical inspector/tool state,
  and the cart trapped focus then returned it to `View cart`.
- Console: 0 errors, 0 warnings after the icon repair. The only messages were
  the React DevTools development info and Next HMR connection log.
- Requests: 94 observed requests were all same-origin development HTML, fonts,
  chunks, the room/cutout images, and the versioned app icon; no dynamic or
  external request appeared during the cart interaction.
- Known process-only warning: Playwright’s Next dev web server prints that
  `NO_COLOR` is ignored while `FORCE_COLOR` is set. It is not a page console or
  application warning.

## Verification matrix

Run and keep green in this order:

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

The final Task 5 report with exact outputs, matrix results, files, self-review,
and residual concerns is at
`.superpowers/sdd/2026-09-01-nook-photo-compositor/task-5-report.md`.

The fresh pre-commit run completed in the required order with exit `0` at every
gate:

1. `pnpm test` — 13 files and 92 tests passed.
2. `pnpm run test:e2e` — all 4 Chromium journeys passed.
3. `pnpm run typecheck` — no TypeScript diagnostics.
4. `pnpm run lint` — no ESLint diagnostics.
5. `pnpm run build` — all 5 vinext phases completed; `/` and `/demo` emitted.
6. `pnpm run build:next` — Next 16.3.3 webpack compiled, type-checked, and
   generated 5/5 static pages including `/icon.svg`.
7. `git diff --check` — no whitespace errors.
8. `git status --short` — only the intended Task 5 code, test, documentation,
   icon, and artifact-ignore changes were present.

Vinext’s Node process prints the upstream `punycode` deprecation warning while
still exiting 0. This is separate from the clean page console.

## Photo commit chain before Task 5

- `960f6cc` — `feat(photo): add calibrated room projection`
- `c409e94` — `feat(photo): add room and furniture asset catalog`
- `3f3e26d` — `fix(photo): correct cutout anchors and style search`
- `4e7a875` — `feat(photo): render editable DOM cutout stage`
- `14b94c0` — `fix(photo): preserve pointer gesture boundaries`
- `232fca1` — `refactor(demo): replace 3D room with photo editor`
- `34e532d` — `fix(demo): restore accessible object rail`

## Next work

1. Review and integrate `feat/photo-compositor` through the chosen local merge
   or pull-request workflow, then rerun the full matrix on the integrated tree.
2. Execute the separate local Claude companion plan only if that workflow is
   still desired; do not infer that it exists from this photo branch.
3. Add live commerce, upload/analysis, persistence, and external providers only
   behind explicit approval and while preserving the deterministic Scene path.
