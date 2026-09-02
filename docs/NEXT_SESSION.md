# Nook Next Session Handoff

Snapshot: 2026-09-03 KST. This is an interim implementation handoff, not the
final natural-placement verification record.

## Verified workspace state

- Worktree: `/Users/taehun/Projects/WebMCP/.worktrees/photo-compositor`
- Branch: `feat/photo-compositor`
- Implementation HEAD before this handoff-only documentation change:
  `546ecb3024b7d081e50ddcd40fccb6c8e0bd19a2`
  (`fix(photo): align floor shadows and rug focus`)
- Base: `main` at `22e884f050b3a907a61eff065e307ec531566001`
- At the wrap point the feature branch was 33 commits ahead of `main` and the
  feature worktree was clean.
- Natural-placement Tasks 1–6 are committed and passed their task-scoped
  implementation reviews. Task 7 was interrupted before any file change,
  report, or commit. Task 8 has not started.
- No merge, rebase, push, pull request, deployment, WebGPU spike, provider
  call, or external cart write was performed.
- Main currently has unrelated `M AGENTS.md` and untracked `.pnpm-store/`
  working changes. They were not added, removed, staged, or modified by this
  feature work; preserve both.

Recovery artifacts for the active plan are ignored working files under:

```text
.superpowers/sdd/2026-09-02-nook-natural-placement/
```

Read `progress.md` first. Task 7's extracted requirements are in
`task-7-brief.md`; there is intentionally no `task-7-report.md` yet.

## Implemented and reviewed through Task 6

### Canonical placement and command behavior

- Validated Scene JSON in Zustand remains the only canonical furniture state.
  Placement diagnostics, DOM geometry, shadows, image failure state, and stage
  measurements are derived.
- The deterministic solver uses room-space metres, oriented physical
  footprints, the 0.1m room inset/grid, opening clearance, a 0.75m circulation
  path, category relationships, fixed locks, bounded candidate/beam search,
  integer scoring, and stable tie-breaking.
- Solver results are pure, duplicate-ID and unlocked-unknown inputs fail
  closed, and changed results resolve to a terminal fixed point. A second call
  against an applied result is a no-op.
- Every non-rug proposal preserves the object's exact input Y rotation. Rugs
  are the only floor-plane rotation exception.
- A complete proposal is validated atomically for exact object membership,
  locks, finite values, Y/rotation preservation, bounds, openings, collisions,
  circulation, and final Scene schema before installation.
- Injected proposers receive deep clones. Validation and installation use the
  untouched original Scene, so a mutate-then-return or mutate-then-throw
  proposer cannot corrupt canonical state.
- Eligible automatic arrangement occurs only on a successful agent
  `replace_object` transition from at least one unlocked placeholder to no
  unlocked placeholders with an unlocked product afterward. The arrangement
  is folded into that same replacement revision, `stateVersion`, history
  entry, and `replace` commit event.
- Human **Arrange naturally** is one atomic internal move batch with one Scene
  revision, one `stateVersion`, one history entry, one `move` event, preserved
  selection/tool mode, and one-step Undo.
- Manual no-op/failure/throw changes no canonical Scene, revision,
  `stateVersion`, history, or observer queue. Automatic no-op/failure still
  commits only the valid requested replacement.
- Reset and Undo clear placement status without arranging or scheduling.
  Observer snapshots are post-install, schema-validated deep clones; observer
  mutation or exceptions cannot affect command success.

### Human UI, Core 6, and cart boundary

- The native **Arrange naturally** control reads the store directly. It is
  disabled during transforms and when every object is locked.
- The sighted `Placement status` region shows the exact store notice. Only a
  successful manual arrangement exposes **Undo placement**, routed through the
  existing Undo action. Its browser-measured target height is at least 44px.
- Stage and composer bounds remained within 0.5px after arrangement at
  1440x900 and 1280x800 in the Task 4 browser gate.
- WebMCP remains exactly the Core 6:
  `get_scene`, `get_selection`, `search_products`, `replace_object`,
  `move_object`, and `add_scene_to_cart`.
- Public `move_object` remains one object at a time. Internal placement outcome
  metadata is not included in strict WebMCP structured content, which remains
  `scene` plus `message`.
- Existing stale revision/`stateVersion`, lock, category, missing-object,
  selection, registration cleanup, and structured-error boundaries remain.
- `add_scene_to_cart` still opens local approval UI only and performs no
  external request.

### Photo projection and grounded DOM

- The photo registry remains 26 WebPs: two exact 1600x900 room assets and 24
  transparent seed/catalog cutouts. Exactly four rug assets have a validated
  registered `floorQuad`; no non-rug does.
- Rug pixels are transformed from audited source quads to projected physical
  floor footprints by a deterministic four-point homography. Invalid or
  unstable projective geometry falls back to the registered anchor layout.
- Registered image load failures use the same keyed, labelled, selectable
  fallback for rug and vertical paths; changing `asset.src` resets failure
  state.
- Depth scale is applied once. Ordinary catalog width ordering is preserved;
  CSS does not apply a second scale.
- Non-rug contact shadows derive their center, axes, dimensions, angle, blur,
  and opacity from projected physical footprint corners. They are
  pointer-transparent and `aria-hidden`.
- Stable composition order is rug pixels/hit layer < contact shadows <
  vertical product pixels < interaction chrome. Same-depth ties use stable
  lexical object ordering.
- Rug selection/focus polygon, floor marker, clipped button, pointer/keyboard
  movement, floor-plane rotation, and 3px non-scaling focus stroke share the
  same destination geometry.
- `ResizeObserver` provides presentation-only stage pixels. Pointer gesture
  state remains transient, and stage dimensions never enter Scene/history.

## Natural-placement commit chain

Oldest to newest:

- `26c6835` — `feat(photo): add placement geometry constraints`
- `d5e6b55` — `test(photo): cover traversable rug obstacles`
- `23dde69` — `feat(photo): propose deterministic room layouts`
- `ac855bd` — `fix(photo): harden deterministic placement search`
- `b288af1` — `fix(photo): preserve cutout rotations in placement`
- `7d3b1ba` — `feat(scene): commit natural placement atomically`
- `4f40fc8` — `fix(scene): isolate placement proposer inputs`
- `02efade` — `feat(demo): add natural placement control`
- `e950d52` — `fix(demo): enforce placement undo target size`
- `3f8dc8d` — `feat(photo): calibrate rugs to the floor plane`
- `74f105d` — `feat(photo): ground furniture on the room floor`
- `546ecb3` — `fix(photo): align floor shadows and rug focus`

## Controller rulings that remain binding

- Normal enforcement of the 32-layout beam and 48 candidates per object is not
  itself `search-limit-exhausted`. That result is for an inconclusive negative
  outcome after an actual bound prunes or truncates the search.
- Rug rendering must preserve existing pointer/keyboard rotation and its
  aligned rotation handle even though the plan's illustrative Task 6 snippet
  omitted those props.
- Every non-rug Y rotation is preserved exactly. Task 3 must reject rather than
  normalize an invalid vertical-cutout rotation proposal.
- Task 7 should prove restoration through the existing header Undo immediately
  after the idempotent no-op, because that no-op status replaces the inline
  **Undo placement** notice without changing history.
- Task 7 browser assertions are an integration verification layer over the
  RED-driven lower layers. A mismatch returns to the owning layer for a
  focused RED test; do not weaken lifecycle or numeric assertions.

## Verification already obtained

The latest Task 6 commit reported these green gates:

- focused photo projection/stage tests: 46/46;
- surrounding photo/asset/workspace tests: 79/79;
- full unit suite: 16 files, 190/190;
- `pnpm run typecheck`: green;
- `pnpm run lint`: green; and
- `pnpm run build`: vinext green.

Earlier task-local browser gates passed before the final Task 6 changes:

- Task 4 demo workspace browser tests: 3/3; and
- Task 5 asset browser audit: 1/1 with all 26 decode/dimension/alpha checks.

These earlier browser runs are not a final current-HEAD E2E claim. Task 7 and
Task 8 must rerun the complete journeys on the final code.

Known non-product process observations:

- vinext prints the upstream Node `punycode` deprecation and informational
  route-classification notice while exiting 0;
- Playwright's Next dev server may print the `NO_COLOR`/`FORCE_COLOR` message;
- high host load caused intermittent 5-second Vitest timeouts, but affected
  tests passed in isolation and the unchanged full commands later passed;
- mixed vinext/Next builds can leave stale ignored `.next/types`; local Next
  type generation restored typecheck. No generated output was committed.

## Not yet verified

Do not describe the feature as integration-ready until all of these complete:

- Task 7 whole-room Core 6/browser journeys on current HEAD;
- current-head full `pnpm run test:e2e`;
- the Task 8 focused and full verification matrices;
- the named 30-sample placement p95 gate on a production Next server;
- fresh seed/redesign/arranged/post-Undo screenshots at both viewports and
  direct visual inspection;
- final independent review against all three photo/natural/hybrid specs; and
- the final verified handoff commit.

One deferred Task 6 Minor also remains for Task 8 visual triage: the projected
rug locked badge is positioned relative to the full-stage clipped button and
may be clipped near a stage corner. Fix it only if the fresh visual/DOM check
confirms the issue, then rerun affected tests and screenshots.

## Safe resume point: Task 7

Resume the SDD loop with a fresh Task 7 implementer from the branch tip. The
last implementation commit is `546ecb3`; a documentation-only handoff commit
may follow it. Modify only:

```text
tests/e2e/photo-compositor.spec.ts
playwright.config.ts
src/features/scene/scene-store.ts
```

Implement in this order:

1. Extend the Core 6 redesign journey so replacements 1–5 preserve every
   non-target X/Z and replacement 6 alone produces the automatic multi-object
   arrangement within its single revision/`stateVersion` result.
2. Build the plan's valid poor layout through existing `move_object` calls;
   verify explicit arrangement atomicity, unchanged selection, collisions and
   opening reachability, idempotent second request, unchanged no-op tokens, and
   exact one-step header Undo restoration.
3. Verify all four rug source/destination corners within 1px, every vertical
   shadow center within 1px of its floor marker, rug underlay order, and stable
   same-depth lexical ordering in the real DOM.
4. Measure only `proposeNaturalPlacement` under the name
   `nook-natural-placement`; retain exactly 30 samples and require p95 <16ms.
5. Add the explicit Playwright production-origin overrides while leaving the
   default development web server unchanged.

Run Task 7's gates exactly, with no literal standalone `--`:

```bash
pnpm exec playwright test tests/e2e/photo-compositor.spec.ts tests/e2e/demo-workspace.spec.ts tests/e2e/photo-assets.spec.ts --config=playwright.config.ts
pnpm exec playwright test tests/e2e/photo-compositor.spec.ts tests/e2e/demo-workspace.spec.ts tests/e2e/photo-assets.spec.ts tests/e2e/webmcp-core.spec.ts --config=playwright.config.ts
pnpm exec vitest run tests/unit/natural-placement.test.ts tests/unit/scene-store.test.ts tests/unit/photo-projection.test.ts tests/unit/room-photo-stage.test.tsx tests/unit/demo-workspace.test.tsx tests/unit/register-tools.test.tsx tests/unit/webmcp-tools.test.ts
```

Commit a reviewed Task 7 only after those gates pass:

```text
test(photo): verify natural placement journeys
```

## Task 8 final gate

After Task 7's task review is clean:

1. Confirm a clean entry status and run the plan's focused unit/browser gate.
2. Run each full command separately and retain exact output:

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

3. Start the already-built production Next app on `127.0.0.1:3100` in a
   managed session, run only the named 30-sample p95 test with
   `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100` and
   `PLAYWRIGHT_SKIP_WEBSERVER=1`, then stop that exact session. Never kill by a
   broad process name.
4. Overwrite stale evidence and directly inspect all eight screenshots:

   ```text
   output/playwright/photo-final-review/seed-1440x900.png
   output/playwright/photo-final-review/redesign-1440x900.png
   output/playwright/photo-final-review/arranged-1440x900.png
   output/playwright/photo-final-review/undo-1440x900.png
   output/playwright/photo-final-review/seed-1280x800.png
   output/playwright/photo-final-review/redesign-1280x800.png
   output/playwright/photo-final-review/arranged-1280x800.png
   output/playwright/photo-final-review/undo-1280x800.png
   ```

5. Require no unresolved Important or higher finding in an independent review
   against:
   - `docs/superpowers/specs/2026-09-01-nook-photo-compositor-design.md`
   - `docs/superpowers/specs/nook-natural-placement-design.md`
   - `docs/superpowers/specs/nook-hybrid-image-renderer-design.md`
6. Only after every gate is green, replace this interim evidence with exact
   final counts, production p95, screenshot observations, warnings, and final
   HEAD, then commit:

   ```text
   docs(photo): record natural placement verification
   ```

Do not merge, push, deploy, or begin WebGPU work during Task 8.

## Conditional work after a green Task 8

The next permitted renderer work is Task 5, **Hard-Gated WebGPU Model Spike**,
in:

```text
docs/superpowers/plans/2026-09-02-nook-hybrid-image-renderer.md
```

The spike must use isolated `/tmp/nook-webgpu-renderer-spike` files and measure
model format/license, explicit cold download and cancellation, verified warm
cache/offline/cache deletion, memory/stability, privacy/network invariants,
real product preservation, and visual improvement. It writes a PASS or FAIL
report. Any failed gate stops the renderer plan before conditional Tasks 6–11;
do not proceed by weakening thresholds.

The local Claude MCP companion remains plan-only in
`docs/superpowers/plans/2026-09-01-nook-local-mcp-companion.md` and is not
implemented.
