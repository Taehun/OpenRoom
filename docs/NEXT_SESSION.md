# Nook Next Session Handoff

Snapshot: 2026-09-03 KST. This is the **final natural-placement verification
record**. It replaces the interim handoff that was written before Task 7.

## Verified workspace state

- Worktree: `/Users/taehun/Projects/WebMCP/.worktrees/photo-compositor`
- Branch: `feat/photo-compositor`
- Final implementation HEAD:
  `aec60e8ee10a9874d1ab6dd44797d0e3b13b3f76`
  (`fix(photo): score seating relations softly`)
- Base: `main` at `22e884f050b3a907a61eff065e307ec531566001` (merge base)
- The branch is **45 commits ahead** of that merge base before this
  documentation-only commit, and the worktree was clean at `aec60e8`.
  The final review was written on `0ed2905` and says 43; the two closing fix
  commits `685fae2` and `aec60e8` bring the count to 45.
- Natural-placement Tasks 1-8 are complete: implemented, browser-verified,
  independently reviewed, and re-reviewed clean after the final fix wave.
- Not merged, not rebased, not pushed, no pull request, not deployed.
- No provider call, no external cart write, no WebGPU work, and no MCP
  companion work was performed.
- `main`'s own `AGENTS.md` working change and its untracked `.pnpm-store/` were
  never added, staged, or modified by this feature work; preserve both.

Recovery artifacts for the plan are ignored working files under:

```text
.superpowers/sdd/2026-09-02-nook-natural-placement/
```

`progress.md` is the ledger; `task-8-report.md` section **"Final run on
`aec60e8`"** holds every number cited below; `final-review.md` is the
independent whole-branch review.

## Implemented semantics

As specified in `docs/superpowers/specs/nook-natural-placement-design.md` and
verified on `aec60e8`.

### Automatic arrangement (spec 4.1)

- Fires only on a successful agent `replace_object` that takes the Scene from
  at least one unlocked placeholder to zero unlocked placeholders with at least
  one unlocked product afterward.
- The arrangement is folded into that same replacement: one revision, one
  `stateVersion`, one history entry, one `replace` commit event.
- Human product preview, intermediate replacements, undo, and reset never
  arrange.
- An automatic no-op or failure still commits the valid requested replacement.

### Explicit human arrangement (spec 4.2, 5.3)

- **Arrange naturally** is a native Human UI control, disabled during a pointer
  or rotation transform and when every object is locked.
- An accepted click is one atomic internal `move` batch: one revision, one
  `stateVersion`, one history entry, one `move` event, selection and tool mode
  preserved, and exact one-step Undo restoration.
- A manual no-op, failure, or throwing proposer mutates nothing and schedules
  nothing (no Scene, revision, `stateVersion`, history, or observer queue
  change).
- The five exact `placementNotice` strings are:
  - `Redesign arranged`
  - `Redesign updated; placement retained`
  - `Placement improved`
  - `Current placement is already the safest option`
  - `Could not improve placement; the room was left unchanged`
- The notice is UI-only (excluded from Scene JSON, history, `stateVersion`,
  tool results, render snapshots, and content hashes). Reset and undo clear it,
  and since `685fae2` **a later commit of any kind clears it**, so a stale
  `Undo placement` affordance can no longer undo the wrong command.

### Boundaries that did not change

- WebMCP is still exactly the Core 6: `get_scene`, `get_selection`,
  `search_products`, `replace_object`, `move_object`, `add_scene_to_cart`.
- Strict tool result content stays `scene` plus `message`; the internal
  `placementOutcome` discriminator never leaks. Public `move_object` remains
  one object at a time.
- `add_scene_to_cart` still opens local approval UI only, with no external
  request.
- Locked objects never move and act as fixed obstacles; an unlocked `unknown`
  object fails the request closed.
- Every non-rug Y rotation is preserved exactly; the validator rejects rather
  than normalizes a changed vertical rotation. Rugs are the only floor-plane
  rotation exception.

### Solver (spec 6)

- Hard constraints are exactly the spec 6.3 list. Since `aec60e8` the two
  seating relations (sofa-to-table edge gap, table inside the rug footprint)
  are **soft-scored** spec 6.4 terms again, not hard constraints, so the
  100-point spec 6.5 threshold and the locked-room failure surface match the
  spec and the command validator agrees with the solver about validity.
- The solver keeps the sofa backed onto a usable wall with the table, rug, and
  chair on its forward side toward the camera.
- Bounded template-seeded search: beam 32 partial layouts, at most 48
  candidates per object, integer scoring quantized from millimetres, stable
  tie-breaking by candidate index then object ID.

### Photo projection and grounding (spec 7)

- Exactly four registered rug assets carry a validated `floorQuad`, in source
  order back-left, back-right, front-right, front-left.
- Rug pixels move through one deterministic four-point homography from the
  registered source quad to the projected physical floor footprint; invalid or
  unstable geometry falls back to the registered anchor layout rather than
  hiding the object.
- One calibrated depth scale is applied exactly once; CSS does not multiply it
  again.
- The five vertical objects receive contact shadows derived from projected
  physical footprint corners; they are pointer-transparent and `aria-hidden`.
- Layer bands are rug < shadow < vertical product < interaction chrome, with
  stable lexical ties at the same depth.
- The projected rug lock badge is anchored to the destination-quad geometry,
  and the placement status stays inside its 44px band.

## Commit chain (`22e884f..aec60e8`, 45 commits)

Eighteen commits `22e884f..b3ff4ea` build the static photo compositor
foundation and include the two hybrid-image-renderer documentation commits
`b4896ad` (`docs: design hybrid image renderer`) and `56c8ffa` (`docs: plan
hybrid image renderer`).

Three natural-placement documentation commits follow:

- `7cf7a6b` — `docs(photo): specify natural furniture placement`
- `0a91cdf` — `docs(photo): approve natural placement design`
- `af232fd` — `docs(photo): plan natural placement implementation`

The natural-placement implementation range `af232fd..aec60e8` is 24 commits,
oldest to newest:

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
- `4698757` — `docs(photo): record natural placement progress`
- `62b84e4` — `fix(photo): prune blocked partial layouts in placement search`
- `799920c` — `fix(photo): complete perimeter candidates in placement search`
- `1550c35` — `perf(photo): score placement partials incrementally`
- `81d84f7` — `fix(photo): verify placement fallback and lane parity`
- `0dd60d2` — `test(photo): verify natural placement journeys`
- `84c56c1` — `fix(scene): keep placement timing best-effort`
- `df11a8b` — `fix(photo): keep seating in front of the sofa`
- `f0e22e5` — `fix(demo): keep placement status inside its band`
- `0ed2905` — `fix(photo): anchor rug lock badge to the floor quad`
- `685fae2` — `fix(scene): clear placement notice on later commits`
- `aec60e8` — `fix(photo): score seating relations softly`

## Verification on `aec60e8`

Entry status clean; every command run separately; all exit 0.

Focused natural-placement gate:

```bash
pnpm exec vitest run tests/unit/placement-geometry.test.ts tests/unit/circulation.test.ts \
  tests/unit/natural-placement.test.ts tests/unit/scene-store.test.ts tests/unit/photo-assets.test.ts \
  tests/unit/photo-projection.test.ts tests/unit/room-photo-stage.test.tsx tests/unit/demo-workspace.test.tsx \
  tests/unit/register-tools.test.tsx tests/unit/webmcp-tools.test.ts
```

- **10 files / 181 tests passed.**

```bash
pnpm exec playwright test tests/e2e/photo-compositor.spec.ts tests/e2e/demo-workspace.spec.ts \
  tests/e2e/photo-assets.spec.ts tests/e2e/webmcp-core.spec.ts --config=playwright.config.ts
```

- **9 passed / 9.**

Full matrix:

| Command | Result |
|---|---|
| `pnpm test` | 16 files / **221 tests** passed |
| `pnpm run test:e2e` | **10 passed / 10** |
| `pnpm run typecheck` | 0 diagnostics |
| `pnpm run lint` | 0 findings |
| `pnpm run build` (vinext) | 5/5 environments |
| `pnpm run build:next` | 5/5 static pages |
| `git diff --check` | clean, no output |
| `git status --short` | clean, no output |

Production performance gate, run against the already-built Next app:

```bash
pnpm exec next start --hostname 127.0.0.1 --port 3100
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 PLAYWRIGHT_SKIP_WEBSERVER=1 \
  pnpm exec playwright test tests/e2e/photo-compositor.spec.ts --config=playwright.config.ts \
  --grep "keeps natural placement below 16ms p95 in the browser"
```

- `nook-natural-placement`, n = 30: **min 2.80 ms, median 3.60 ms,
  p95 5.10 ms, max 9.00 ms** against the 16 ms budget.
- The server was started and stopped by its recorded PID only; ports 3100 and
  3000 were confirmed free afterward.

## Visual evidence

Eight screenshots captured on the production server at both viewports:

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

Direct observations:

- The rug lies on the calibrated floor plane, not rising like furniture.
- All 40 shadow/anchor pairs (5 vertical objects x 8 captures) agree with their
  registered anchors to better than **0.0005 px**.
- The seating group reads coherently: sofa on the back wall, then rug and
  table, with the chair toward the camera.
- Arranged room-space positions, identical at both viewports:
  sofa `(-1.70, -1.80)`, table `(-1.70, -0.60)`, rug `(-1.70, -0.60)`,
  chair `(-1.70, 0.50)`, lamp `(0.60, 2.00)`, plant `(2.40, -1.80)`.
- Status band clearance above the stage: **+10.50 px at 1440x900** and
  **+0.41 px at 1280x800**; the 0.41 px margin is a consequence of the existing
  topbar geometry, not of this feature.
- **Zero console messages** and **zero external requests** in all eight
  captures; `add_scene_to_cart` approval stays local.

One product-polish observation for a follow-up, not a spec violation: the chair
sits directly in front of the coffee table at the same x, so the table is
mostly occluded from the camera. A lateral chair offset would read better, but
the solver is viewport-agnostic by spec.

## Independent review outcome

`final-review.md` (independent whole-branch review, 2026-09-03) returned
**"With fixes"**: 0 Critical, 2 Important, 18 Minor.

Both Important findings are fixed and were re-reviewed clean:

- **I-1** — `installCommit` kept `placementNotice` across later commits, so a
  stale `Undo placement` affordance undid the wrong command. Fixed in
  `685fae2`; verified in the DOM (one keyboard move after an arrangement
  removes the whole status region; revision/`stateVersion` 14 to 15).
- **I-2** — `respectsSeatingRelations` enforced two spec 6.4 soft terms as hard
  constraints, bypassing the 100-point threshold and failing spec-valid locked
  rooms. Fixed in `aec60e8` by demoting both to soft scoring; journeys A/B/C
  are byte-identical to `0ed2905`.

### Minor findings carried forward (none fixed in this plan)

Reviewer's **fix-later** subset is marked with `*`.

- `M-1*` — `edgeGapAlongAxis` is unsigned, so a human-placed table behind the
  sofa can be retained as candidate 0; a signed gap closes the V-3 class.
- `M-2*` — the fixed-point loop returns `search-limit-exhausted` even when
  pass 0 produced a validated improvement; return best-so-far instead.
- `M-3` — `search-limit-exhausted` is a coarse classification (any beam
  truncation with a null best); diagnostics only.
- `M-4` — `evaluatedLayouts` counts final beam states, not scored layouts; the
  name over-promises.
- `M-5` — movement (term 7) is minimised per pass rather than against the
  original Scene in passes after the first.
- `M-6` — two named spec 6.4 sub-terms are absent (rug 0-0.20 m sofa-front
  relation; chair table clearance), only implied by candidate generation.
- `M-7` — `photo-projection.ts` `layerOrder` is a dead export kept alive by its
  own test; delete both.
- `M-8*` — the `role="status"` node is mounted on demand; keep a permanently
  mounted container or mirror into the existing polite live region.
- `M-9*` — the 0.41 px status-band clearance at 1280x800 should be reserved
  explicitly rather than relying on incidental geometry.
- `M-10*` — `.placementStatus` uses an inset box-shadow that is invisible in
  forced-colors mode, with zero block padding.
- `M-11` — no positive test for "locked placeholders do not prevent
  completion".
- `M-12` — E2E collision/opening/reachability oracles are the production
  predicates; one independent AABB check would remove the theoretical vacuity.
- `M-13*` — `natural-placement.test.ts:507` no longer exercises candidate
  truncation; re-fixtured with I-2's resolution.
- `M-14` — `_traversableRugs` in `circulation.ts` is used despite its
  unused-parameter prefix; rename.
- `M-15` — four Task 2b invariants deserve one-line contract comments.
- `M-16*` — the x-wall sofa sweep has no side filter, unlike the z-wall sweep.
- `M-17*` — `natural-placement.ts` is 1,888 lines; a follow-up split would make
  reviews tractable.
- `M-18` — `Array.prototype.toSorted` needs an ES2023 runtime (Chromium 110+,
  Safari 16+, Node 20+); `tsconfig` `lib: esnext` hides it from typecheck.

`M-7`, `M-11`, and `M-14` were flagged as minutes-each opportunistic fixes.

### Spec clarifications for the owner

These are wording issues in the spec, not implementation defects:

- Spec 6.3 bullet 3 ("an unlocked footprint intersects a locked non-rug
  footprint") conflicts with 6.1 ("an unlocked rug may overlap furniture by
  design"); the implementation follows 6.1. Reword to "an unlocked *non-rug*
  footprint".
- Spec 6.3 bullet 1 says the inset applies to "a non-rug footprint", but
  `respectsHardConstraints` applies the room inset to rugs as well.
- Spec 6.3 "A locked rug remains a fixed seating zone" never says what the zone
  requires.
- Spec 5.3 ("existing live regions are reused") versus 9 (a sighted
  `role=status` area) leaves the announcement path ambiguous.
- The plan's Task 4 never specified the notice lifecycle across later commits,
  which is why I-1 was not caught earlier.

## Controller rulings that remain binding

All eleven rulings were confirmed to stand by the final review. See
`.superpowers/sdd/2026-09-02-nook-natural-placement/progress.md` for the full
text; the load-bearing ones are:

- Normal enforcement of the 32-layout beam and 48 candidates per object is not
  itself `search-limit-exhausted`.
- Rug rendering preserves pointer/keyboard rotation and the aligned rotation
  handle.
- Task 7 proves one-step restoration through the existing header Undo
  immediately after the idempotent no-op.
- Every non-rug Y rotation is preserved; Task 3's validator rejects rather than
  normalizes an invalid vertical rotation.
- A browser mismatch returns to the owning layer for a focused RED test; never
  weaken the E2E assertion.
- Option B (a real solver rework as Task 2b) rather than editing the poor-layout
  fixture.
- A3 is verified at the unit level of `resolvePlacementSearch`.
- Sofa candidates use only walls the sofa does not face, with table/chair on
  its forward side.
- V-1 (status band) and V-2 (rug lock badge) are fixed in their owning layers.
- I-2 is resolved by demoting the two relations to soft scoring rather than
  amending spec 6.3.

## Residual items and known notices

Additional deferred minors recorded in the ledger:

- `tableCandidates` still generates candidates only inside the 350-550 mm band,
  so the solver cannot propose an out-of-band table gap even where one would
  score better; the search cannot fail on this because the current placement
  seeds the candidate set.
- The `prunedByBeam` arm of `exhausted` has no end-to-end witness after the
  re-fixture; it is unit-covered in `resolvePlacementSearch`.
- `applyCommand` returns early on a failed command and leaves an existing
  placement notice in place. No commit occurred, so the notice still describes
  the last committed outcome.
- `799920c` and `1550c35` carry subagent commit trailers; cosmetic, squash at
  finish if desired.

Known upstream-only notices, none of which indicate a product problem:

- vinext prints the Node `punycode` `DEP0040` deprecation and an informational
  "Some routes could not be classified" static-analysis notice while exiting 0.
- Playwright's Next dev server may print a `NO_COLOR`/`FORCE_COLOR` message.
- Mixed vinext and Next builds can leave ignored `.next/types` residue; the
  Next build regenerates it. No generated output is committed.

## Next permitted step

The next permitted renderer work is **Task 5, Hard-Gated WebGPU Model Spike**,
in:

```text
docs/superpowers/plans/2026-09-02-nook-hybrid-image-renderer.md
```

It is time-boxed and must use isolated throwaway files under
`/tmp/nook-webgpu-renderer-spike`, measuring model format and license, explicit
cold download and cancellation, verified warm cache / offline / cache deletion,
memory and stability, privacy and network invariants, real product
preservation, and visual improvement. It writes a PASS or FAIL report to:

```text
docs/superpowers/spikes/2026-09-02-nook-webgpu-renderer.md
```

Any failed gate stops the renderer plan before its conditional Tasks 6-11; do
not proceed by weakening thresholds.

The local Claude MCP companion remains plan-only in
`docs/superpowers/plans/2026-09-01-nook-local-mcp-companion.md` and is not
implemented.

Merging, pushing, opening a pull request, and deploying remain the branch
owner's decision.

## Local MCP companion

Added on branch `feat/local-mcp-companion`; this supersedes the "plan-only" note
above. `pnpm mcp:openinterior` runs `scripts/openinterior-mcp/server.ts`: an
official MCP SDK v2 stdio server that advertises exactly the Core 6 from
`src/webmcp/core-tool-manifest.ts` and forwards every `tools/call` to one
explicitly paired browser page over a `127.0.0.1` relay. The process keeps no
Scene state, prints its port and single-use pair code to stderr only, and tears
the relay down once on `SIGINT`, `SIGTERM`, or stdin close.

- `OPENINTERIOR_MCP_PORT` (`0` or `1024`-`65535`, default `43110`) and
  `OPENINTERIOR_ALLOWED_ORIGINS` (exact, comma separated) configure it.
- `tests/integration/local-mcp-companion.test.ts` drives the real spawned
  process with the official `@modelcontextprotocol/client`; it now runs as part
  of `pnpm test` (`tests/integration/**/*.test.ts` was added to the Vitest
  include).
- Setup for Claude Desktop, Claude Code, and Codex CLI is in
  `docs/local-mcp.md`; the surface matrix is in the README.
- The pair code is single use, but exactly one is always live: the companion
  mints a replacement after five failed attempts and whenever a paired page
  disconnects or misses its heartbeat, so re-pairing never needs a restart.

## Facing vectors and views (2026-09-04)

Spec: `docs/superpowers/specs/2026-09-03-openinterior-facing-views-design.md`;
plan: `docs/superpowers/plans/2026-09-03-openinterior-facing-views.md`.

What changed:

- Every cutout carries a stored front vector; every Scene object exposes a
  derived `facing` (never stored; `rotation[1]` stays the source of truth).
  `src/features/photo/photo-facing.ts`, `photo-views.ts`,
  `photo-views.generated.ts` (manifest written by the pipeline).
- The compositor renders the registered view nearest the object's facing,
  mirroring the left/right twin, instead of tilting one picture with CSS
  `rotate`. A facing more than 45° from any view is drawn with the nearest view
  and disclosed as approximate (stage badge + inspector row).
- `get_scene`, `get_selection`, and the committed Scenes returned by
  `move_object`/`replace_object` carry `facing`; `move_object` accepts a
  `facing { x, z }` vector (mutually exclusive with `rotationYDegrees`). Eval
  `face-the-sofa` added.
- The solver turns objects only toward directions a registered view can show
  (`buildRotationOptions` → `PlacementOptions.rotationOptions`, validated again
  by the command adapter), scores view fidelity and composition, flanks the
  sofa with the chair, parks the lamp beside a sofa end and the plant in a back
  corner. Profile version 2; p95 8.7 ms on a production build.
- `pnpm assets:views` (`scripts/openinterior-assets/`) plans and performs
  gpt-image-1 edits offline for the missing views (28 jobs for the demo
  catalog), writes anchored WebPs beside the originals and rewrites the
  manifest module. Key only in `.env.local`; never runs in CI; the app never
  imports it. See `docs/asset-views.md`.

Accepted staged composition (spec 8.5, pinned by unit tests): sofa (-1.3,
-1.1) at -45°, table (-0.3, 0.1), rug (-0.3, 0.2) at -45°, chair (0.8, -1.0)
at +45° (mirrored view), lamp (-2.6, 0.0), plant (-2.4, -1.7). A sofa square on
the back wall is unreachable in the demo room because of the window clearance.

Owner actions still open:

- Put `OPENAI_API_KEY` in `.env.local` and run
  `pnpm assets:views --product hinoki-low-sofa --view side` first; review the
  image, then run the full `pnpm assets:views` (28 images). Commit the WebPs
  and `photo-views.generated.ts`.
- With generated views registered, the solver's option table widens to every
  45° step automatically; no code change is needed.
