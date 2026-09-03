# Nook Natural Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nook's first completed catalog redesign and explicit Human UI arrangement produce a deterministic, collision-aware composition with floor-projected rugs, credible relative scale, depth order, and contact shadows.

**Architecture:** A pure placement package proposes room-space placements from validated Scene data, and a command-layer adapter atomically validates and commits them without adding a public tool. The Scene store owns completion-trigger orchestration, one-entry undo, noncanonical notices, and one post-commit event; photo projection remains the only room-to-stage geometry path and gains registered rug-plane and shadow outputs.

**Tech Stack:** TypeScript 5, React 19.2, Next 16.3.3 App Router, Zustand 5, Zod 4, CSS Modules, Vitest 4 with Testing Library, Playwright 1.62, vinext.

**Spec:** `docs/superpowers/specs/nook-natural-placement-design.md`

## Global Constraints

- Work only in `/Users/taehun/Projects/WebMCP/.worktrees/photo-compositor` on `feat/photo-compositor`; start from approved-spec commit `0a91cdf` or a descendant.
- Do not modify the original static photo spec or the approved hybrid renderer spec while executing this plan.
- Validated Scene JSON in Zustand remains the only canonical furniture state; DOM, CSS, placement diagnostics, and render artifacts are derived.
- Keep exactly the WebMCP Core 6 and their current strict schemas. Add no arrange, batch, execute, render, image, or model tool.
- Keep public `move_object` one-object-at-a-time and keep stale revision, `stateVersion`, locks, category validation, selection, registration cleanup, and structured errors intact.
- A manual arrangement is one revision, one `stateVersion` increment, one history entry, one `move` commit event, and one-step Undo. A manual no-op/failure mutates and schedules nothing.
- Automatic arrangement runs only for an `actor: "agent"` replacement that changes the Scene from at least one unlocked placeholder to none. It is folded into that one replacement revision and emits one `replace` event.
- Locked objects never move. An unlocked `unknown` object fails closed. Reset and undo never arrange or schedule.
- Candidate search is deterministic: 0.1m room inset/grid, 0.75m circulation width, 32-layout beam, at most 48 candidates per object, integer 0-10,000 score, and 100-point improvement threshold.
- Depth scale is applied exactly once. Every rug uses a validated registered `floorQuad`; registered rug pixels are projectively transformed rather than regenerated.
- The DOM compositor remains immediately usable. Product alpha, accessible buttons, fallback labels, pointer/keyboard editing, cart approval, and zero external writes remain intact.
- Before changing React, CSS, or Next-facing code, read the relevant local Next 16.3.3 guides under `node_modules/next/dist/docs/`; do not rely on remembered framework behavior.
- Use TDD for every behavior change: observe RED for the intended reason, implement the minimum coherent behavior, then run the focused GREEN command.
- Do not merge, rebase, push, open a pull request, deploy, implement the local MCP companion, or start the WebGPU spike in this plan.
- Do not add, remove, or stage main worktree `.pnpm-store/` content.

## File and Interface Map

- Create `src/features/placement/placement-types.ts` — shared placement result, footprint, diagnostics, and profile version types.
- Create `src/features/placement/footprint-geometry.ts` — oriented rectangles, room bounds, opening zones, and collision primitives.
- Create `src/features/placement/circulation.ts` — deterministic 0.1m occupancy grid and reachability.
- Create `src/features/placement/placement-profile.ts` — candidate bounds and exact scoring weights.
- Create `src/features/placement/natural-placement.ts` — pure template-seeded beam search and idempotent proposal selection.
- Create `src/features/scene/natural-placement-command.ts` — full-proposal validation and atomic Scene application without a second state model.
- Modify `src/features/scene/scene-schema.ts` — internal automatic placement outcome metadata on successful command results only; no public tool-schema change.
- Modify `src/features/scene/scene-store.ts` — injected proposer/commit observer, completion trigger, `arrangeNaturally`, `placementNotice`, and atomic history behavior.
- Create `src/features/photo/projective-transform.ts` — solve/apply a four-point homography and serialize its CSS `matrix3d`.
- Create `src/features/photo/photo-asset-image.tsx` — shared keyed image failure/reset behavior and labelled selectable fallback content.
- Create `src/features/photo/photo-rug-layer.tsx` — floor-projected rug pixels, clipped transparent button, and top interaction chrome.
- Create `src/features/photo/photo-contact-shadow.tsx` — pointer-transparent computed shadow.
- Modify `src/features/photo/photo-assets.ts` — optional `floorQuad` type plus required metadata for four registered rug assets.
- Modify `src/features/photo/photo-projection.ts` — physical footprint projection, rug transform, one-scale widths, stable layer order, and shadow geometry.
- Modify `src/features/photo/photo-object-layer.tsx` — vertical cutouts only plus shared registered fallback behavior.
- Modify `src/features/photo/room-photo-stage.tsx` — measured stage size, rug/vertical/shadow layers, and unchanged direct-manipulation commits.
- Modify `src/features/demo/room-canvas.tsx` and `demo-workspace.module.css` — Arrange naturally control and stable sighted status.
- Add focused unit files under `tests/unit/`, extend `tests/e2e/photo-assets.spec.ts`, `photo-compositor.spec.ts`, and `demo-workspace.spec.ts`, and refresh `docs/NEXT_SESSION.md` only after the final green review.

---

### Task 1: Placement Geometry and Circulation

**Files:**
- Create: `src/features/placement/placement-types.ts`
- Create: `src/features/placement/footprint-geometry.ts`
- Create: `src/features/placement/circulation.ts`
- Create: `tests/unit/placement-geometry.test.ts`
- Create: `tests/unit/circulation.test.ts`

**Interfaces:**
- Consumes: `Scene`, `SceneObject`, `DimensionsM`, and `Vec3` from `src/features/scene/scene-schema.ts`.
- Produces: `PLACEMENT_PROFILE_VERSION`, `PointXZ`, `Footprint2D`, `ProposedPlacement`, `PlacementDiagnostics`, `PlacementFailureReason`, `NaturalPlacementResult`, `objectFootprint`, `footprintCorners`, `footprintInsideRoom`, `footprintsOverlap`, `openingClearanceZones`, and `hasCirculationPath`.

- [ ] **Step 1: Write failing oriented-footprint and bounds tests**

Create `tests/unit/placement-geometry.test.ts` with real Scene objects and behavior assertions, including rotated separation rather than implementation snapshots:

```ts
import { describe, expect, it } from "vitest";
import { createDemoScene } from "../../src/demo/demo-scene";
import {
  footprintInsideRoom,
  footprintsOverlap,
  objectFootprint,
  openingClearanceZones,
} from "../../src/features/placement/footprint-geometry";

describe("placement footprint geometry", () => {
  it("uses physical width/depth and Y rotation for overlap", () => {
    const scene = createDemoScene();
    const sofa = structuredClone(scene.objects.find(({ id }) => id === "sofa_01")!);
    const table = structuredClone(scene.objects.find(({ id }) => id === "table_01")!);
    sofa.position = [0, sofa.position[1], 0];
    table.position = [1.3, table.position[1], 0];
    expect(footprintsOverlap(objectFootprint(sofa), objectFootprint(table))).toBe(true);
    table.position = [1.3, table.position[1], 1.2];
    table.rotation[1] = Math.PI / 2;
    expect(footprintsOverlap(objectFootprint(sofa), objectFootprint(table))).toBe(false);
  });

  it("checks every rotated corner against the 0.1m inset", () => {
    const scene = createDemoScene();
    const chair = structuredClone(scene.objects.find(({ id }) => id === "chair_01")!);
    chair.position = [2.5, chair.position[1], 0];
    chair.rotation[1] = Math.PI / 4;
    expect(footprintInsideRoom(objectFootprint(chair), scene.room, 0.1)).toBe(false);
    chair.position = [1.8, chair.position[1], 0];
    expect(footprintInsideRoom(objectFootprint(chair), scene.room, 0.1)).toBe(true);
  });

  it("maps normalized opening offsets to exact wall clearance zones", () => {
    const scene = createDemoScene();
    expect(openingClearanceZones(scene)).toEqual([
      expect.objectContaining({
        wall: "back",
        depthM: 0.75,
        widthM: expect.closeTo(1.8, 8),
      }),
    ]);
  });
});
```

- [ ] **Step 2: Write failing circulation tests**

Create `tests/unit/circulation.test.ts` and prove rugs are traversable while an inflated wall of furniture blocks the foreground-to-opening path:

```ts
import { describe, expect, it } from "vitest";
import { createDemoScene } from "../../src/demo/demo-scene";
import { hasCirculationPath } from "../../src/features/placement/circulation";
import type { Footprint2D } from "../../src/features/placement/placement-types";

describe("placement circulation", () => {
  it("finds the demo opening from the foreground when only a rug crosses the route", () => {
    const scene = createDemoScene();
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    expect(hasCirculationPath(scene, [], [rug])).toBe(true);
  });

  it("rejects a 0.75m route blocked across the room", () => {
    const scene = createDemoScene();
    const barrier: Footprint2D = {
      objectId: "barrier",
      center: { x: 0, z: 0 },
      halfWidth: 2.9,
      halfDepth: 0.45,
      rotationY: 0,
    };
    expect(hasCirculationPath(scene, [barrier], [])).toBe(false);
  });
});
```

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/placement-geometry.test.ts tests/unit/circulation.test.ts
```

Expected: FAIL because the placement modules do not exist.

- [ ] **Step 4: Add exact shared types and geometry primitives**

Define the shared result contract in `placement-types.ts` exactly once:

```ts
export const PLACEMENT_PROFILE_VERSION = 1 as const;

export interface PointXZ { x: number; z: number }
export interface Footprint2D {
  objectId: string;
  center: PointXZ;
  halfWidth: number;
  halfDepth: number;
  rotationY: number;
}
export interface OpeningClearanceZone extends Footprint2D {
  wall: Scene["openings"][number]["wall"];
  widthM: number;
  depthM: 0.75;
}
export interface ProposedPlacement {
  objectId: string;
  position: Vec3;
  rotationY: number;
}
export interface PlacementDiagnostics {
  currentScore: number | null;
  proposedScore: number | null;
  evaluatedLayouts: number;
}
export type PlacementFailureReason =
  | "invalid-input"
  | "no-valid-layout"
  | "search-limit-exhausted"
  | "unexpected";
export type NaturalPlacementResult =
  | { kind: "changed"; placements: readonly ProposedPlacement[]; diagnostics: PlacementDiagnostics }
  | { kind: "unchanged"; reason: "already-safe" | "no-safe-improvement"; diagnostics: PlacementDiagnostics }
  | { kind: "failed"; reason: PlacementFailureReason };
```

Implement `footprintCorners` with cosine/sine rotation, `footprintsOverlap`
with four separating axes, and `footprintInsideRoom` by testing every corner.
`openingClearanceZones` must map front/back offsets across room width and
left/right offsets across room depth; each zone adds 0.2m on both sides and
extends 0.75m into the room. Its exact signature is:

```ts
export function objectFootprint(object: SceneObject): Footprint2D;
export function footprintCorners(footprint: Footprint2D): readonly [PointXZ, PointXZ, PointXZ, PointXZ];
export function footprintsOverlap(first: Footprint2D, second: Footprint2D): boolean;
export function footprintInsideRoom(footprint: Footprint2D, room: DimensionsM, insetM?: number): boolean;
export function openingClearanceZones(scene: Scene): readonly OpeningClearanceZone[];
```

- [ ] **Step 5: Implement the deterministic circulation grid**

Use these constants and contract in `circulation.ts`:

```ts
const GRID_METRES = 0.1;
const PATH_WIDTH_METRES = 0.75;
const PATH_RADIUS_METRES = PATH_WIDTH_METRES / 2;

export function hasCirculationPath(
  scene: Scene,
  obstacles: readonly Footprint2D[],
  _traversableRugs: readonly SceneObject[],
): boolean;
```

Inflate non-rug obstacles by 0.375m, mark grid-cell centers inside their
oriented footprint, start from the 0.75m front-center segment when there is no
door, and run four-neighbor BFS in the fixed order up, right, down, left. Return
true only when every Scene opening's 0.75m access zone is reachable. Do not use
randomness or viewport pixels.

- [ ] **Step 6: Run focused GREEN and typecheck**

Run:

```bash
pnpm exec vitest run tests/unit/placement-geometry.test.ts tests/unit/circulation.test.ts
pnpm run typecheck
```

Expected: both test files pass and TypeScript reports no diagnostics.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/features/placement/placement-types.ts src/features/placement/footprint-geometry.ts src/features/placement/circulation.ts tests/unit/placement-geometry.test.ts tests/unit/circulation.test.ts
git diff --cached --check
git commit -m "feat(photo): add placement geometry constraints"
```

### Task 2: Deterministic Natural Placement Solver

**Files:**
- Create: `src/features/placement/placement-profile.ts`
- Create: `src/features/placement/natural-placement.ts`
- Create: `tests/helpers/natural-placement-fixtures.ts`
- Create: `tests/unit/natural-placement.test.ts`

**Interfaces:**
- Consumes: all Task 1 geometry/types plus validated `Scene` objects.
- Produces: `PLACEMENT_LIMITS`, `PLACEMENT_SCORE_WEIGHTS`, and `proposeNaturalPlacement(scene: Scene): NaturalPlacementResult`.

- [ ] **Step 1: Add a reusable completed-redesign fixture**

Create `tests/helpers/natural-placement-fixtures.ts`. It must clone the demo
Scene, replace every object with the first same-category `DEMO_PRODUCTS` entry,
set product dimensions and floor Y exactly as production replace does, and
leave revision/selection irrelevant to solver output:

```ts
export function completedProductScene(): Scene {
  const scene = structuredClone(createDemoScene());
  for (const object of scene.objects) {
    const product = DEMO_PRODUCTS.find(({ category }) => category === object.type);
    if (!product) throw new Error(`Missing product for ${object.type}`);
    object.source = "product";
    object.assetId = product.id;
    object.product = {
      id: product.id,
      variantId: product.variantId,
      title: product.title,
      category: product.category,
      price: structuredClone(product.price),
      dimensionsCm: structuredClone(product.dimensionsCm),
      styleTags: [...product.styleTags],
      color: product.color,
      material: product.material,
    };
    object.dimensionsM = {
      width: product.dimensionsCm.width / 100,
      height: product.dimensionsCm.height / 100,
      depth: product.dimensionsCm.depth / 100,
    };
    object.position[1] = object.type === "rug" ? 0.01 : object.dimensionsM.height / 2;
  }
  return SceneSchema.parse(scene);
}
```

- [ ] **Step 2: Write failing solver contract tests**

Create `tests/unit/natural-placement.test.ts` with these independent outcomes:

```ts
it("returns byte-equivalent proposals without mutating its Scene", () => {
  const scene = completedProductScene();
  const before = structuredClone(scene);
  const first = proposeNaturalPlacement(scene);
  const second = proposeNaturalPlacement(scene);
  expect(first).toEqual(second);
  expect(scene).toEqual(before);
  expect(first.kind).toBe("changed");
});

it("keeps locked objects exact and includes every movable known object", () => {
  const scene = completedProductScene();
  const locked = scene.objects.find(({ id }) => id === "sofa_01")!;
  locked.locked = true;
  const before = structuredClone(locked);
  const result = proposeNaturalPlacement(scene);
  expect(result.kind).toBe("changed");
  if (result.kind !== "changed") return;
  expect(result.placements.some(({ objectId }) => objectId === locked.id)).toBe(false);
  expect(result.placements).toHaveLength(scene.objects.length - 1);
  expect(scene.objects.find(({ id }) => id === locked.id)).toEqual(before);
});

it("fails closed for an unlocked unknown object", () => {
  const scene = completedProductScene();
  scene.objects[0]!.type = "unknown";
  expect(proposeNaturalPlacement(scene)).toEqual({ kind: "failed", reason: "invalid-input" });
});
```

Add relationship assertions after applying returned placements to a test clone:
the sofa is on the same left half as before, the table's sofa-edge gap is
0.35-0.55m, the table center lies inside the rug footprint, non-rugs do not
overlap, and `hasCirculationPath` is true. Call the solver again on that clone
and expect `kind: "unchanged"`.

- [ ] **Step 3: Run the solver test and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/natural-placement.test.ts
```

Expected: FAIL because `placement-profile.ts` and `natural-placement.ts` do not
exist.

- [ ] **Step 4: Define the exact bounded profile**

Export these frozen values from `placement-profile.ts`:

```ts
export const PLACEMENT_LIMITS = Object.freeze({
  roomInsetM: 0.1,
  gridM: 0.1,
  beamWidth: 32,
  candidatesPerObject: 48,
  improvementThreshold: 100,
});

export const PLACEMENT_SCORE_WEIGHTS = Object.freeze({
  circulation: 2500,
  sofaWallAndSide: 1700,
  tableRelation: 1800,
  rugRelation: 1600,
  chairRelation: 1000,
  accessories: 800,
  movement: 600,
});
```

The values sum to 10,000. Each private term returns an integer 0-1000 before
weighting; divide by 1000 with integer rounding to keep the aggregate integral.

- [ ] **Step 5: Implement template-seeded beam search**

Implement `proposeNaturalPlacement` with a stable category order of sofa, rug,
coffee table, chair, floor lamp, plant. For each object, include the current
placement, then stable 0.1m candidates. Sofa candidates keep current X-sign and
use Y-rotation-compatible back/front walls; table candidates use 0.35-0.55m
sofa edge gaps; rug candidates center on sofa/table; chair candidates occupy
the opposite conversation zone; accessories use remaining perimeter gaps.

Use this control flow, keeping candidate/scoring helpers private:

```ts
export function proposeNaturalPlacement(scene: Scene): NaturalPlacementResult {
  if (!SceneSchema.safeParse(scene).success || hasUnlockedUnknown(scene)) {
    return { kind: "failed", reason: "invalid-input" };
  }
  const current = evaluateCompleteLayout(scene, currentPlacements(scene));
  const search = searchLayouts(scene, PLACEMENT_LIMITS);
  if (search.exhausted) return { kind: "failed", reason: "search-limit-exhausted" };
  if (!search.best) return { kind: "failed", reason: "no-valid-layout" };
  if (current.valid && search.best.score < current.score + PLACEMENT_LIMITS.improvementThreshold) {
    return {
      kind: "unchanged",
      reason: search.best.score === current.score ? "already-safe" : "no-safe-improvement",
      diagnostics: diagnostics(current, search),
    };
  }
  return {
    kind: "changed",
    placements: search.best.placements,
    diagnostics: diagnostics(current, search),
  };
}
```

Define those private helpers with these consistent signatures in the same
module; do not export solver internals merely for tests:

```ts
interface EvaluatedLayout {
  valid: boolean;
  score: number;
  placements: readonly ProposedPlacement[];
}
interface LayoutSearch {
  best: EvaluatedLayout | null;
  evaluatedLayouts: number;
  exhausted: boolean;
}
function hasUnlockedUnknown(scene: Scene): boolean;
function currentPlacements(scene: Scene): readonly ProposedPlacement[];
function evaluateCompleteLayout(
  scene: Scene,
  placements: readonly ProposedPlacement[],
): EvaluatedLayout;
function searchLayouts(
  scene: Scene,
  limits: typeof PLACEMENT_LIMITS,
): LayoutSearch;
function diagnostics(
  current: EvaluatedLayout,
  search: LayoutSearch,
): PlacementDiagnostics;
```

Quantize metres to integer millimetres before distance scoring. Sort exact score
ties by the full candidate-index vector and then object ID. Catch no exceptions
inside geometry helpers; convert only expected invalid input/search outcomes to
the declared result union.

- [ ] **Step 6: Run solver and geometry GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/natural-placement.test.ts tests/unit/placement-geometry.test.ts tests/unit/circulation.test.ts
pnpm run typecheck
```

Expected: all focused placement tests pass with deterministic results.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/features/placement/placement-profile.ts src/features/placement/natural-placement.ts tests/helpers/natural-placement-fixtures.ts tests/unit/natural-placement.test.ts
git diff --cached --check
git commit -m "feat(photo): propose deterministic room layouts"
```

### Task 3: Atomic Scene Integration and Commit Events

**Files:**
- Create: `src/features/scene/natural-placement-command.ts`
- Modify: `src/features/scene/scene-schema.ts`
- Modify: `src/features/scene/scene-store.ts`
- Modify: `tests/unit/scene-commands.test.ts`
- Modify: `tests/unit/scene-store.test.ts`
- Modify: `tests/unit/webmcp-tools.test.ts`

**Interfaces:**
- Consumes: `proposeNaturalPlacement`, `NaturalPlacementResult`, the existing `applySceneCommand`, Scene history, and command actors.
- Produces: `validateAndApplyPlacement`, `PlacementNotice`, `ArrangeNaturallyResult`, `SceneCommitEvent`, `SceneStoreOptions`, `SceneStoreState.arrangeNaturally()`, and optional internal `placementOutcome` on successful replacement results.

- [ ] **Step 1: Write failing atomic manual-arrangement tests**

Extend `tests/unit/scene-store.test.ts`:

```ts
test("commits natural placement once and one undo restores every object", () => {
  const events: SceneCommitEvent[] = [];
  const store = createSceneStore(completedProductScene(), {
    onCommit: (event) => events.push(event),
  });
  const before = structuredClone(store.getState().scene);
  const stateVersion = store.getState().stateVersion;
  const result = store.getState().arrangeNaturally();

  expect(result).toMatchObject({ ok: true, changed: true });
  expect(store.getState().scene.revision).toBe(before.revision + 1);
  expect(store.getState().stateVersion).toBe(stateVersion + 1);
  expect(store.getState().history).toHaveLength(1);
  expect(store.getState().scene.selectedObjectId).toBe(before.selectedObjectId);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ cause: "move", revision: before.revision + 1 });

  expect(store.getState().undo()).toBe(true);
  expect(store.getState().scene).toEqual(before);
  expect(events).toHaveLength(1);
});
```

Add injected proposer cases for `unchanged`, `failed`, and a thrown exception.
Each must leave Scene/history/stateVersion untouched, emit no commit event, and
publish the exact notice message from the spec. Add a proposal that omits one
unlocked known object and prove full-proposal validation rejects it atomically.

- [ ] **Step 2: Write failing automatic-completion tests**

In `scene-store.test.ts`, apply one same-category product replacement per demo
object. Assert X/Z placements remain exact after replacements one through five.
On replacement six, assert revision/stateVersion still advance by exactly one,
multiple unlocked positions change as one result, `placementOutcome.kind` is
`auto-arranged`, notice text is `Redesign arranged`, history grows by one, and
the observer receives exactly one `replace` event containing the final Scene.

Repeat with `actor: "human"` for the final replacement and prove there is no
auto arrangement. Add stale, category mismatch, locked, missing-object, undo,
and reset paths and prove they do not invoke an injected proposer.

- [ ] **Step 3: Run focused Scene tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/scene-store.test.ts tests/unit/scene-commands.test.ts tests/unit/webmcp-tools.test.ts
```

Expected: FAIL because the atomic adapter, store APIs, and outcome metadata do
not exist.

- [ ] **Step 4: Implement full-proposal command validation**

Create `natural-placement-command.ts` with this non-mutating adapter:

```ts
export type PlacementApplication =
  | { ok: true; changed: true; scene: Scene }
  | { ok: true; changed: false; scene: Scene }
  | { ok: false; scene: Scene; reason: PlacementFailureReason };

export function validateAndApplyPlacement(
  scene: Scene,
  proposal: NaturalPlacementResult,
): PlacementApplication;
```

For `changed`, require exactly one proposal for every unlocked known object and
none for locked/unknown/missing IDs. Reject duplicate IDs, non-finite values,
changed Y, changed vertical-object rotation, room-bound violations, non-rug
collisions, opening blockage, and failed circulation. Parse the final clone
through `SceneSchema`. Preserve the input revision; the caller owns the one
increment.

- [ ] **Step 5: Add exact store result and observer types**

Use these public-in-module shapes in `scene-store.ts`:

```ts
export type PlacementNoticeKind =
  | "auto-arranged" | "auto-retained"
  | "manual-arranged" | "manual-unchanged" | "manual-failed";
export interface PlacementNotice { id: number; kind: PlacementNoticeKind; message: string }
export interface SceneCommitEvent { cause: "replace" | "move"; revision: number; scene: Scene }
export interface SceneStoreOptions {
  onCommit?: (event: SceneCommitEvent) => void;
  proposePlacement?: typeof proposeNaturalPlacement;
}
export type ArrangeNaturallyResult =
  | { ok: true; changed: true; scene: Scene }
  | { ok: true; changed: false; scene: Scene }
  | { ok: false; changed: false; scene: Scene; reason: PlacementFailureReason };
```

Extend the successful `CommandResult` arm with optional internal
`placementOutcome?: { kind: "auto-arranged" | "auto-retained" }`. The WebMCP
tool-result schema and handler output must not include it.

- [ ] **Step 6: Implement completion orchestration and manual batching**

In `applyCommand`, first call the existing `applySceneCommand`. Only after a
successful agent `replace` that crosses the exact completion boundary, call the
injected/default proposer against `result.scene`, validate its full result, and
fold a changed proposal into `result.scene` without another revision. Catch a
proposer exception as `auto-retained`. Install the final Scene once, append
`result.previousScene` once, and publish one notice.

In `arrangeNaturally`, propose/validate against the current Scene, clone and
increment the accepted Scene revision once, set one history entry and one
`stateVersion`, and publish the manual notice. Clear `placementNotice` in
`undo()` and `reset()` without adding an extra `stateVersion` increment.

Invoke `onCommit` only after Zustand contains the accepted Scene, only for
successful replace/move commits, and with a deep validated clone. Wrap the
observer in `try/catch`; observer failure must not affect the command result.

Use one predicate for the trigger and one store installation path:

```ts
function completesUnlockedRedesign(
  before: Scene,
  after: Scene,
  request: CommandRequest,
) {
  return request.actor === "agent" &&
    request.command.type === "replace" &&
    before.objects.some(({ locked, source }) => !locked && source === "placeholder") &&
    !after.objects.some(({ locked, source }) => !locked && source === "placeholder") &&
    after.objects.some(({ locked, source }) => !locked && source === "product");
}

function notifyCommit(observer: SceneStoreOptions["onCommit"], event: SceneCommitEvent) {
  try {
    observer?.({ ...event, scene: SceneSchema.parse(structuredClone(event.scene)) });
  } catch {
    // A derived-render observer cannot affect canonical command success.
  }
}
```

- [ ] **Step 7: Prove Core 6 and strict tool results remain unchanged**

Extend `tests/unit/webmcp-tools.test.ts` to complete all six replacements and
assert the last returned Scene is the already-arranged final Scene at revision
7/stateVersion 7. Assert `Object.keys(structuredContent.data)` contains only the
existing `scene` and `message` keys. Keep the exact six-name assertion in
`tool-contracts.test.ts` unchanged.

- [ ] **Step 8: Run focused GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/natural-placement.test.ts tests/unit/scene-store.test.ts tests/unit/scene-commands.test.ts tests/unit/webmcp-tools.test.ts tests/unit/tool-contracts.test.ts
pnpm run typecheck
```

Expected: all tests pass; automatic and manual commits have exact atomicity.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/features/scene/natural-placement-command.ts src/features/scene/scene-schema.ts src/features/scene/scene-store.ts tests/unit/scene-commands.test.ts tests/unit/scene-store.test.ts tests/unit/webmcp-tools.test.ts
git diff --cached --check
git commit -m "feat(scene): commit natural placement atomically"
```

### Task 4: Arrange Naturally Human UI

**Files:**
- Modify: `src/features/demo/demo-workspace.tsx`
- Modify: `src/features/demo/room-canvas.tsx`
- Modify: `src/features/demo/demo-workspace.module.css`
- Modify: `tests/unit/demo-workspace.test.tsx`
- Modify: `tests/unit/room-photo-stage.test.tsx`
- Modify: `tests/e2e/demo-workspace.spec.ts`

**Interfaces:**
- Consumes: `SceneStoreState.arrangeNaturally`, `isTransforming`, and `placementNotice` from Task 3.
- Produces: accessible `Arrange naturally` button, stable visible status, manual Undo affordance, and no new Demo reducer state.

- [ ] **Step 1: Read the required local Next guides**

Run and read completely before editing TSX/CSS:

```bash
cat node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
cat node_modules/next/dist/docs/01-app/01-getting-started/11-css.md
cat node_modules/next/dist/docs/03-architecture/accessibility.md
```

- [ ] **Step 2: Write failing component behavior tests**

Extend `tests/unit/demo-workspace.test.tsx` with a visible, native-button test:

```ts
test("arranges through Human UI and one Undo restores the Scene", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);
  const before = screen.getByRole("status", { name: "Scene diagnostics" }).textContent;

  await user.click(screen.getByRole("button", { name: "Arrange naturally" }));
  expect(screen.getByRole("status", { name: "Placement status" }))
    .toHaveTextContent("Placement improved");
  expect(screen.getByRole("button", { name: "Undo placement" })).toBeVisible();
  expect(screen.getByRole("status", { name: "Scene diagnostics" }).textContent)
    .not.toBe(before);

  await user.click(screen.getByRole("button", { name: "Undo placement" }));
  expect(screen.getByRole("status", { name: "Scene diagnostics" }).textContent)
    .toBe(before);
});
```

Add tests that the button is disabled during an active pointer transform and
when a custom injected Scene has every object locked. Let `DemoWorkspace`
accept an optional `store?: SceneStore` prop and pass it to its existing
`SceneStoreProvider`; production calls remain `<DemoWorkspace />`. Use that seam
for injected unchanged and failed proposer tests, then assert the exact sighted
messages, no Undo button, and unchanged revision.

- [ ] **Step 3: Add a failing real-browser layout-stability test**

Extend `tests/e2e/demo-workspace.spec.ts`: at both 1440x900 and 1280x800 record
the stage bounding box and composer bounding box, click **Arrange naturally**,
wait for `Placement improved`, and assert all x/y/width/height values are within
0.5px of their prior values. Assert the status itself is visible.

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/demo-workspace.test.tsx tests/unit/room-photo-stage.test.tsx
pnpm exec playwright test tests/e2e/demo-workspace.spec.ts --config=playwright.config.ts
```

Expected: FAIL because the button/status do not exist.

- [ ] **Step 5: Implement the control without parallel UI state**

In `DemoWorkspace`, add only this testable dependency seam:

```tsx
export function DemoWorkspace({ store }: { store?: SceneStore } = {}) {
  return (
    <SceneStoreProvider store={store}>
      <DemoWorkspaceContent />
    </SceneStoreProvider>
  );
}
```

In `RoomCanvas`, subscribe directly to `arrangeNaturally`, `isTransforming`, and
`placementNotice`. Put the native button in `canvasTopbar`; disable it when
`isTransforming` or `scene.objects.every(({ locked }) => locked)`. Invoke only
the store method:

```tsx
<button
  className={styles.arrangeButton}
  disabled={isTransforming || scene.objects.every(({ locked }) => locked)}
  onClick={() => arrangeNaturally()}
  type="button"
>
  Arrange naturally
</button>
```

Render one fixed-position/absolute `role="status"` named `Placement status`.
Only `manual-arranged` includes a button named `Undo placement`, which dispatches
the existing `{ type: "undo" }` action. Do not add a second Scene or copy the
notice into `DemoState`.

- [ ] **Step 6: Add stable CSS and reduced-motion behavior**

Give `canvasTopbar` a reserved status/control region and keep status out of grid
flow. Use existing paper/moss tokens, a 44px minimum target, visible focus, and
no arrangement animation. Ensure the status and button never overlap
`.sceneSelectionLabel`, `.undoToast`, or prompt composer at the two reference
viewports.

- [ ] **Step 7: Run focused GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/demo-workspace.test.tsx tests/unit/room-photo-stage.test.tsx tests/unit/scene-store.test.ts
pnpm exec playwright test tests/e2e/demo-workspace.spec.ts --config=playwright.config.ts
pnpm run typecheck
pnpm run lint
```

Expected: UI behavior, accessibility, and layout-stability tests pass.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/features/demo/demo-workspace.tsx src/features/demo/room-canvas.tsx src/features/demo/demo-workspace.module.css tests/unit/demo-workspace.test.tsx tests/unit/room-photo-stage.test.tsx tests/e2e/demo-workspace.spec.ts
git diff --cached --check
git commit -m "feat(demo): add natural placement control"
```

### Task 5: Rug Registry and Projective Geometry

**Files:**
- Modify: `src/features/photo/photo-assets.ts`
- Create: `src/features/photo/projective-transform.ts`
- Modify: `src/features/photo/photo-projection.ts`
- Modify: `tests/unit/photo-assets.test.ts`
- Modify: `tests/unit/photo-projection.test.ts`
- Modify: `tests/e2e/photo-assets.spec.ts`

**Interfaces:**
- Consumes: room projection calibration, `SceneObject`, registered intrinsic dimensions, and Task 1 `PointXZ`/footprint geometry.
- Produces: `NormalizedQuad`, `StageSize`, `ProjectiveTransform`, `isValidFloorQuad`, `solveProjectiveTransform`, `applyProjectiveTransform`, and `projectRugPlacement`.

- [ ] **Step 1: Write failing registry validation tests**

Extend `tests/unit/photo-assets.test.ts` so the four exact rug IDs have a valid
clockwise, non-self-intersecting quad and every non-rug omits it:

```ts
const RUG_ASSET_IDS = [
  "seed-pattern-rug",
  "woven-jute-rug",
  "wool-pebble-rug",
  "geometric-flatweave-rug",
] as const;

it("registers a valid source floor quadrilateral for every rug only", () => {
  for (const id of RUG_ASSET_IDS) {
    const quad = PHOTO_ASSETS[id]?.floorQuad;
    expect(quad, id).toBeDefined();
    expect(isValidFloorQuad(quad!), id).toBe(true);
  }
  expect(
    Object.values(PHOTO_ASSETS).filter(({ floorQuad }) => floorQuad !== undefined),
  ).toHaveLength(4);
});
```

Extend `tests/e2e/photo-assets.spec.ts` to pass `floorQuad` through the browser
audit and assert the same four IDs after all 26 images decode and alpha checks
still pass.

- [ ] **Step 2: Write failing four-point projection tests**

In `tests/unit/photo-projection.test.ts`, verify a solved transform maps all four
source points to their destination within 0.01px at a 1024x576 stage:

```ts
it("maps every registered rug corner to its projected physical footprint", () => {
  const scene = completedProductScene();
  const rug = scene.objects.find(({ id }) => id === "rug_01")!;
  const asset = PHOTO_ASSETS[rug.assetId!]!;
  const projection = projectRugPlacement(rug, asset, scene.room, {
    width: 1024,
    height: 576,
  });
  expect(projection).not.toBeNull();
  projection!.sourcePixels.forEach((source, index) => {
    expect(applyProjectiveTransform(projection!.transform, source).x)
      .toBeCloseTo(projection!.destinationPixels[index]!.x, 2);
    expect(applyProjectiveTransform(projection!.transform, source).y)
      .toBeCloseTo(projection!.destinationPixels[index]!.y, 2);
  });
});
```

Add degenerate, counter-clockwise, out-of-range, NaN, and self-intersecting
quad cases and expect `isValidFloorQuad` false or `projectRugPlacement` null.
Also assert physical width/depth and Y rotation change the destination points.

- [ ] **Step 3: Run asset/projection tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/photo-assets.test.ts tests/unit/photo-projection.test.ts
pnpm exec playwright test tests/e2e/photo-assets.spec.ts --config=playwright.config.ts
```

Expected: FAIL because `floorQuad` and projective helpers do not exist.

- [ ] **Step 4: Register the audited rug source quads**

Add this exact optional field to `PhotoAsset`:

```ts
export type NormalizedQuad = readonly [
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
];

export interface PhotoAsset {
  id: string;
  src: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  anchorX: number;
  anchorY: number;
  floorQuad?: NormalizedQuad;
}
```

Use the approved order back-left, back-right, front-right, front-left and these
initial audited points. Keep them in the registry, not Scene JSON. Define this
constant and reference its entries from the four existing asset records:

```ts
const RUG_FLOOR_QUADS = {
  "seed-pattern-rug": [{ x: 0.439, y: 0.112 }, { x: 0.995, y: 0.367 }, { x: 0.304, y: 0.986 }, { x: 0.008, y: 0.224 }],
  "woven-jute-rug": [{ x: 0.508, y: 0.221 }, { x: 0.970, y: 0.322 }, { x: 0.756, y: 0.920 }, { x: 0.012, y: 0.589 }],
  "wool-pebble-rug": [{ x: 0.310, y: 0.205 }, { x: 0.962, y: 0.492 }, { x: 0.793, y: 0.834 }, { x: 0.029, y: 0.607 }],
  "geometric-flatweave-rug": [{ x: 0.521, y: 0.206 }, { x: 0.982, y: 0.691 }, { x: 0.182, y: 0.928 }, { x: 0.022, y: 0.301 }],
} as const satisfies Record<string, NormalizedQuad>;
```

These points are calibration inputs. During Task 8 visual review, adjust a point
only when the fresh screenshot shows a source edge missing the projected floor
plane; update its exact unit expectation in the same commit.

- [ ] **Step 5: Implement and test the homography solver**

In `projective-transform.ts`, solve the eight unknowns of a 3x3 homography with
`h33 = 1` using Gaussian elimination with partial pivoting. Reject a pivot or
denominator whose absolute value is below `1e-9`. Export:

```ts
export interface PixelPoint { x: number; y: number }
export type ProjectiveTransform = readonly [
  number, number, number,
  number, number, number,
  number, number, 1,
];
export function solveProjectiveTransform(
  source: readonly [PixelPoint, PixelPoint, PixelPoint, PixelPoint],
  destination: readonly [PixelPoint, PixelPoint, PixelPoint, PixelPoint],
): ProjectiveTransform | null;
export function isValidFloorQuad(quad: NormalizedQuad): boolean;
export function applyProjectiveTransform(
  transform: ProjectiveTransform,
  point: PixelPoint,
): PixelPoint;
export function projectiveTransformCss(
  transform: ProjectiveTransform,
): string;
```

Serialize CSS in the DOMMatrix column order
`[h11,h21,0,h31,h12,h22,0,h32,0,0,1,0,h13,h23,0,1]` with finite decimal
numbers and `transform-origin: 0 0`.

- [ ] **Step 6: Project physical rug footprints**

In `photo-projection.ts`, rotate the four width/depth corners around the rug's
Scene `(x,z)`, call `projectRoomPoint` for each, multiply normalized destination
points by `StageSize`, convert registered normalized source points by intrinsic
asset width/height, solve the transform, and return:

```ts
export interface StageSize { width: number; height: number }
export interface RugProjection {
  sourcePixels: readonly [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
  destinationPixels: readonly [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
  destinationNormalized: NormalizedQuad;
  transform: ProjectiveTransform;
  cssTransform: string;
}

export function projectRugPlacement(
  object: SceneObject,
  asset: PhotoAsset,
  room: Pick<Scene["room"], "width" | "depth">,
  stage: StageSize,
): RugProjection | null;
```

Return null for non-rugs, missing/invalid `floorQuad`, zero stage size, a point
outside the calibrated floor domain, or unstable homography.

- [ ] **Step 7: Run focused GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/photo-assets.test.ts tests/unit/photo-projection.test.ts
pnpm exec playwright test tests/e2e/photo-assets.spec.ts --config=playwright.config.ts
pnpm run typecheck
```

Expected: all registry, alpha, and four-corner projection checks pass.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/features/photo/photo-assets.ts src/features/photo/projective-transform.ts src/features/photo/photo-projection.ts tests/unit/photo-assets.test.ts tests/unit/photo-projection.test.ts tests/e2e/photo-assets.spec.ts
git diff --cached --check
git commit -m "feat(photo): calibrate rugs to the floor plane"
```

### Task 6: Grounded DOM Composition

**Files:**
- Create: `src/features/photo/photo-rug-layer.tsx`
- Create: `src/features/photo/photo-contact-shadow.tsx`
- Create: `src/features/photo/photo-asset-image.tsx`
- Modify: `src/features/photo/photo-projection.ts`
- Modify: `src/features/photo/photo-object-layer.tsx`
- Modify: `src/features/photo/room-photo-stage.tsx`
- Modify: `src/features/demo/demo-workspace.module.css`
- Modify: `tests/unit/photo-projection.test.ts`
- Modify: `tests/unit/room-photo-stage.test.tsx`

**Interfaces:**
- Consumes: Task 5 `RugProjection`, existing registered image fallback, asset anchors, pointer/keyboard handlers, and Scene room projection.
- Produces: shared keyed `PhotoAssetImage`/`PhotoAssetFallback`, `projectContactShadow`, `stableLayerOrder`, `PhotoRugLayer`, `PhotoContactShadow`, measured stage geometry, and aligned rug/shadow interaction layers.

- [ ] **Step 1: Read the remaining required local Next image guide**

Run and read completely before editing the image components:

```bash
cat node_modules/next/dist/docs/01-app/01-getting-started/12-images.md
cat node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
```

Retain the documented, justified native `<img>` exception because transformable
alpha cutouts require their intrinsic boxes and local registered assets.

- [ ] **Step 2: Write failing scale, order, and shadow geometry tests**

Extend `tests/unit/photo-projection.test.ts`:

```ts
it("preserves catalog physical-width ordering with one depth scale", () => {
  const depth = 0.8;
  expect(objectVisualWidth(2.4, depth, "rug")).toBeGreaterThan(objectVisualWidth(2.24, depth, "sofa"));
  expect(objectVisualWidth(2.24, depth, "sofa")).toBeGreaterThan(objectVisualWidth(1.1, depth, "coffee_table"));
  expect(objectVisualWidth(1.1, depth, "coffee_table")).toBeGreaterThan(objectVisualWidth(0.58, depth, "floor_lamp"));
});

it("anchors a bounded contact shadow to the physical footprint", () => {
  const scene = completedProductScene();
  const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
  const shadow = projectContactShadow(sofa, scene.room);
  const anchor = projectRoomPoint({ x: sofa.position[0], z: sofa.position[2] }, scene.room);
  expect(shadow.left).toBeCloseTo(anchor.left, 6);
  expect(shadow.top).toBeCloseTo(anchor.top, 6);
  expect(shadow.width).toBeGreaterThan(shadow.height);
  expect(shadow.opacity).toBeGreaterThan(0);
  expect(shadow.opacity).toBeLessThanOrEqual(0.28);
});
```

Add a stable lexical tie test for two objects at the same projected floor Y and
assert rugs receive an underlay order below every vertical object.

- [ ] **Step 3: Write failing RoomPhotoStage DOM tests**

Extend `tests/unit/room-photo-stage.test.tsx` with a `ResizeObserver` stub and a
1024x576 `getBoundingClientRect`. Assert:

```ts
expect(screen.getByTestId("photo-rug-visual-rug_01"))
  .toHaveAttribute("data-floor-projected", "true");
expect(screen.getByRole("button", { name: "Rug" }).style.clipPath)
  .toContain("polygon(");
expect(screen.getAllByTestId(/photo-contact-shadow-/)).toHaveLength(5);
expect(screen.getByTestId("photo-contact-shadow-sofa_01"))
  .toHaveAttribute("aria-hidden", "true");
```

Select the rug through its clipped button, assert the floor marker/selection
polygon uses the same destination quad, and keep the registered-image failure
test labelled and selectable. Add a zero-size stage case that renders the same
registered rug image through the prior anchor-based layout, still labelled and
selectable, without throwing.

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/photo-projection.test.ts tests/unit/room-photo-stage.test.tsx
```

Expected: FAIL because rug/shadow components and geometry do not exist.

- [ ] **Step 5: Implement stable layer and contact-shadow projection**

Keep `objectVisualWidth(widthM, depthScale, type)` as the only width-scale
application. Replace ordinary-case clamping with broad overflow safety bounds
that do not flatten the tested product ordering.

Use these exact percentage bounds with the existing 18 percentage-points per
metre coefficient. Use the shadow profiles for non-rugs only:

```ts
const VISUAL_WIDTH_BOUNDS = {
  sofa: [14, 60],
  coffee_table: [7, 40],
  rug: [12, 70],
  floor_lamp: [4, 24],
  chair: [6, 38],
  plant: [6, 34],
  unknown: [6, 60],
} as const;

const CONTACT_SHADOW_PROFILES = {
  sofa: { widthFactor: 0.72, depthFactor: 0.35, opacity: 0.22 },
  coffee_table: { widthFactor: 0.75, depthFactor: 0.55, opacity: 0.20 },
  floor_lamp: { widthFactor: 0.45, depthFactor: 0.45, opacity: 0.18 },
  chair: { widthFactor: 0.65, depthFactor: 0.50, opacity: 0.20 },
  plant: { widthFactor: 0.55, depthFactor: 0.50, opacity: 0.19 },
  unknown: { widthFactor: 0.60, depthFactor: 0.45, opacity: 0.18 },
} as const;
```

Interpolate blur from 4px at calibrated back depth to 10px at front depth and
clamp opacity to at most 0.28.

Implement:

```ts
export interface ContactShadowProjection {
  left: number;
  top: number;
  width: number;
  height: number;
  rotationDegrees: number;
  blurPx: number;
  opacity: number;
  zIndex: number;
}
export function projectContactShadow(
  object: SceneObject,
  room: Pick<Scene["room"], "width" | "depth">,
): ContactShadowProjection;
export function stableLayerOrder(object: SceneObject, placement: ProjectedPlacement, lexicalIndex: number): number;
```

Compute footprint corners through `projectRoomPoint`, bound shadow width/height
by per-category profile values, and derive blur/opacity from the already
computed depth scale. Return a rug underlay below all vertical layers; for equal
floor Y use the lexical object-ID index. Do not apply depth again in CSS.

- [ ] **Step 6: Add measured stage size and dedicated rug/shadow layers**

In `RoomPhotoStage`, attach a `ResizeObserver` to the 16:9 section and retain
only `{width,height}` as derived presentation state. Initialize from
`getBoundingClientRect()` in a layout effect and update only when dimensions
change. This state must never enter Scene/history.

Render in this order:

1. projective rug visuals and clipped rug buttons at underlay z-order;
2. pointer-transparent contact shadows for five vertical objects;
3. existing vertical `PhotoObjectLayer` buttons at stable floor order; and
4. selected/focus rug polygon, marker, and other interaction chrome above
   product pixels.

Move the keyed image/error-state behavior from `photo-object-layer.tsx` into
`photo-asset-image.tsx` so rug and vertical paths share the same `key={asset.src}`
reset and labelled fallback. Do not duplicate image error state.

`PhotoRugLayer` renders the source image at registered intrinsic pixel size with
`transformOrigin: "0 0"` and the Task 5 CSS matrix. Its transparent full-stage
button uses the destination quad as a percentage `clip-path`; the visual image
itself is pointer-transparent. Keep the same pointer/keyboard callbacks and
accessible label as the old rug button.

If projective geometry is unavailable, `PhotoRugLayer` uses the existing
anchor-based image placement, not the unavailable-image label. An actual image
load error still switches to the shared labelled fallback.

`PhotoContactShadow` is an `aria-hidden` span with `pointer-events:none`. Put no
shadow inside the registered `<img>` and no shadow in Scene state.

Keep component boundaries explicit:

```tsx
{rugObjects.map((object) => (
  <PhotoRugLayer
    key={object.id}
    label={objectLabel(object)}
    object={object}
    projection={rugProjections.get(object.id) ?? null}
    onClick={() => selectObject(object.id)}
    onKeyDown={(event) => handleObjectKeyDown(object, event)}
    onPointerCancel={(event) => cancelTransform(object, event)}
    onPointerDown={(event) => startTransform(object, event, "move")}
    onPointerMove={(event) => previewMove(object, event)}
    onPointerUp={(event) => finishTransform(object, event)}
    selected={scene.selectedObjectId === object.id}
  />
))}
{verticalObjects.map((object) => (
  <PhotoContactShadow
    key={`shadow-${object.id}`}
    objectId={object.id}
    projection={projectContactShadow(object, scene.room)}
  />
))}
{verticalObjects.map((object) => (
  <PhotoObjectLayer
    key={object.id}
    label={objectLabel(object)}
    object={object}
    onClick={() => selectObject(object.id)}
    onKeyDown={(event) => handleObjectKeyDown(object, event)}
    onPointerCancel={(event) => cancelTransform(object, event)}
    onPointerDown={(event) => startTransform(object, event, "move")}
    onPointerMove={(event) => previewMove(object, event)}
    onPointerUp={(event) => finishTransform(object, event)}
    onRotationPointerCancel={(event) => cancelTransform(object, event)}
    onRotationPointerDown={(event) => startTransform(object, event, "rotate")}
    onRotationPointerMove={(event) => previewRotation(object, event)}
    onRotationPointerUp={(event) => finishTransform(object, event)}
    placement={projectRoomPoint({ x: object.position[0], z: object.position[2] }, scene.room)}
    selected={scene.selectedObjectId === object.id}
    showRotationHandle={scene.selectedObjectId === object.id && toolMode === "rotate" && !object.locked}
    visualWidth={objectVisualWidth(object.dimensionsM.width, projectRoomPoint({ x: object.position[0], z: object.position[2] }, scene.room).scale, object.type)}
  />
))}
```

- [ ] **Step 7: Add CSS for projective visuals without breaking hit layers**

Add focused classes for full-stage rug visual, clipped hit button, SVG/HTML
selection polygon, and contact shadow. Use `will-change` only during an active
transform, preserve visible keyboard focus, and keep the existing vertical
fallback. Remove the generic hover `drop-shadow` from product pixels when the
new physical shadow is present so depth is not doubled.

- [ ] **Step 8: Run focused GREEN and surrounding regressions**

Run:

```bash
pnpm exec vitest run tests/unit/photo-projection.test.ts tests/unit/room-photo-stage.test.tsx tests/unit/photo-assets.test.ts tests/unit/demo-workspace.test.tsx
pnpm run typecheck
pnpm run lint
```

Expected: projection and component tests pass with no framework diagnostics.

- [ ] **Step 9: Commit Task 6**

```bash
git add src/features/photo/photo-rug-layer.tsx src/features/photo/photo-contact-shadow.tsx src/features/photo/photo-asset-image.tsx src/features/photo/photo-projection.ts src/features/photo/photo-object-layer.tsx src/features/photo/room-photo-stage.tsx src/features/demo/demo-workspace.module.css tests/unit/photo-projection.test.ts tests/unit/room-photo-stage.test.tsx
git diff --cached --check
git commit -m "feat(photo): ground furniture on the room floor"
```

### Task 7: Whole-Room Browser Journeys and Performance Gate

**Files:**
- Modify: `tests/e2e/photo-compositor.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `src/features/scene/scene-store.ts`

**Interfaces:**
- Consumes: exact Core 6 capture helpers, natural-placement button/status, Scene diagnostics, commit events, rug/shadow DOM markers, and all current cart/network assertions.
- Produces: real-browser proof for exact automatic trigger, manual atomicity/Undo/no-op, projection alignment, stable layout, privacy, and p95 solver duration.

- [ ] **Step 1: Add automatic-completion assertions to the Core 6 journey**

In `photo-compositor.spec.ts`, capture all object X/Z values before replacements.
After replacements one through five, assert every non-target X/Z remains exact.
After replacement six, assert:

```ts
function changedObjectIds(before: BrowserScene, after: BrowserScene) {
  return after.objects
    .filter((object) => {
      const previous = before.objects.find(({ id }) => id === object.id);
      return previous !== undefined &&
        (previous.position[0] !== object.position[0] ||
          previous.position[2] !== object.position[2]);
    })
    .map(({ id }) => id);
}

expect(replaced.structuredContent.sceneRevision).toBe(revision + 1);
expect(replaced.structuredContent.stateVersion).toBe(stateVersion + 1);
await expect(page.getByRole("status", { name: "Placement status" }))
  .toHaveText("Redesign arranged");
expect(changedObjectIds(beforeFinalReplace, sceneFrom(replaced)).length)
  .toBeGreaterThan(1);
```

Keep the existing exact Core 6 names, six product assets, stale rejection,
drag/undo, cart approval, zero write/fetch, cleanup, and console assertions.

- [ ] **Step 2: Add explicit arrangement, idempotence, and one-Undo journey**

Use existing `move_object` calls with fresh concurrency tokens to create this
valid but poor unlocked layout after the six-product redesign:

```ts
const poorTargets = {
  sofa_01: { x: -1.8, z: 0.2 },
  table_01: { x: 1.2, z: 0.8 },
  rug_01: { x: 0.9, z: 0.9 },
  lamp_01: { x: 0.2, z: 1.8 },
  chair_01: { x: 2.2, z: -0.7 },
  plant_01: { x: -2.3, z: -1.5 },
} as const;
```

Read and save the entire Scene, click **Arrange naturally**, assert one revision
and one stateVersion increment, unchanged selection, no footprint collisions,
reachable opening, and `Placement improved`. Click again; assert
`Current placement is already the safest option` with unchanged tokens. Click
`Undo placement` from the first successful status before the no-op replaces it,
or use the existing header Undo immediately after the no-op, and prove every
saved position/rotation is restored by that single undo.

Locked-object immutability remains a store/component integration test because
the shipped demo has no Human UI or Core 6 operation that creates a lock. Do not
add a test-only browser backdoor or a seventh tool merely to manufacture one.

- [ ] **Step 3: Add on-stage geometry assertions**

At the stage's actual CSS pixel geometry, read each registered rug's destination
polygon and transformed source corners. Assert all four differ by less than 1px.
For every vertical object assert the contact shadow center differs from its
floor marker by less than 1px. Assert rug z-index is below all five objects and
same-depth lexical ties are stable.

- [ ] **Step 4: Instrument and test the 16ms p95 target**

Around only `proposeNaturalPlacement`, create a browser performance measure
named `nook-natural-placement`; clear the start/end marks after measuring but
retain measure entries for the session. In the E2E test, run the solver once on
the poor layout and 29 times on the idempotent improved Scene. Clear old entries
before the first sample because the completion transition also measures:

```ts
await page.evaluate(() => performance.clearMeasures("nook-natural-placement"));
const arrange = page.getByRole("button", { name: "Arrange naturally" });
const status = page.getByRole("status", { name: "Placement status" });
for (let index = 0; index < 30; index += 1) {
  await arrange.click();
  await expect(status).toHaveText(
    index === 0
      ? "Placement improved"
      : "Current placement is already the safest option",
  );
}
const durations = await page.evaluate(() =>
  performance.getEntriesByName("nook-natural-placement")
    .map(({ duration }) => duration)
    .sort((a, b) => a - b),
);
const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
expect(durations).toHaveLength(30);
expect(p95).toBeLessThan(16);
```

Name this Playwright test exactly
`keeps natural placement below 16ms p95 in the browser` so Task 8 can select it
without running unrelated journeys.

Use one synchronous wrapper for both automatic and manual calls:

```ts
function measuredPlacementProposal(
  proposer: typeof proposeNaturalPlacement,
  scene: Scene,
) {
  const start = performance.now();
  try {
    return proposer(scene);
  } finally {
    performance.measure("nook-natural-placement", {
      start,
      duration: performance.now() - start,
    });
  }
}
```

Run this gate against a production Next server in Task 8 as well; a development
server result is diagnostic only.

Make `playwright.config.ts` accept the explicit production override without
changing its default development behavior:

```ts
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  use: { baseURL: externalBaseUrl ?? "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: skipWebServer ? undefined : {
    command: "pnpm exec next dev --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

- [ ] **Step 5: Run the new focused browser tests**

Run:

```bash
pnpm exec playwright test tests/e2e/photo-compositor.spec.ts tests/e2e/demo-workspace.spec.ts tests/e2e/photo-assets.spec.ts --config=playwright.config.ts
```

Expected: the already unit-driven implementation should pass. If a new journey
fails, record the exact mismatch, return to the owning task, add a focused RED
unit/component test, and make a separate reviewed fix commit. Do not weaken
numeric or lifecycle assertions to accept stale/partial state.

- [ ] **Step 6: Run focused browser GREEN plus Core 6 regression**

Run:

```bash
pnpm exec playwright test tests/e2e/photo-compositor.spec.ts tests/e2e/demo-workspace.spec.ts tests/e2e/photo-assets.spec.ts tests/e2e/webmcp-core.spec.ts --config=playwright.config.ts
pnpm exec vitest run tests/unit/natural-placement.test.ts tests/unit/scene-store.test.ts tests/unit/photo-projection.test.ts tests/unit/room-photo-stage.test.tsx tests/unit/demo-workspace.test.tsx tests/unit/register-tools.test.tsx tests/unit/webmcp-tools.test.ts
```

Expected: all natural-placement, photo, and Core 6 journeys pass.

- [ ] **Step 7: Commit Task 7**

```bash
git add tests/e2e/photo-compositor.spec.ts playwright.config.ts src/features/scene/scene-store.ts
git diff --cached --check
git commit -m "test(photo): verify natural placement journeys"
```

### Task 8: Full Matrix, Two-Viewport Visual Review, and Handoff

**Files:**
- Modify: `docs/NEXT_SESSION.md`
- Refresh ignored evidence: `output/playwright/photo-final-review/seed-1440x900.png`
- Refresh ignored evidence: `output/playwright/photo-final-review/redesign-1440x900.png`
- Refresh ignored evidence: `output/playwright/photo-final-review/seed-1280x800.png`
- Refresh ignored evidence: `output/playwright/photo-final-review/redesign-1280x800.png`
- Add ignored evidence: `output/playwright/photo-final-review/arranged-1440x900.png`
- Add ignored evidence: `output/playwright/photo-final-review/arranged-1280x800.png`
- Add ignored evidence: `output/playwright/photo-final-review/undo-1440x900.png`
- Add ignored evidence: `output/playwright/photo-final-review/undo-1280x800.png`

**Interfaces:**
- Consumes: final Task 1-7 commit chain and both governing photo specs.
- Produces: fresh complete verification evidence, production performance evidence, two-viewport visual evidence, independent review findings, and an accurate next-session handoff. This task authorizes no WebGPU work.

- [ ] **Step 1: Run the focused natural-placement gate from a clean tree**

Run:

```bash
git status --short
pnpm exec vitest run tests/unit/placement-geometry.test.ts tests/unit/circulation.test.ts tests/unit/natural-placement.test.ts tests/unit/scene-store.test.ts tests/unit/photo-assets.test.ts tests/unit/photo-projection.test.ts tests/unit/room-photo-stage.test.tsx tests/unit/demo-workspace.test.tsx tests/unit/register-tools.test.tsx tests/unit/webmcp-tools.test.ts
pnpm exec playwright test tests/e2e/photo-compositor.spec.ts tests/e2e/demo-workspace.spec.ts tests/e2e/photo-assets.spec.ts tests/e2e/webmcp-core.spec.ts --config=playwright.config.ts
```

Expected: clean entry status and all focused tests pass. The Playwright command
must contain no literal standalone `--`.

- [ ] **Step 2: Run the full verification matrix in order**

Run each command separately and retain exact counts/output:

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

Expected: every command exits 0. Treat the known vinext `punycode` deprecation
and Playwright `NO_COLOR`/`FORCE_COLOR` process messages as upstream warnings
only if the page console remains clean; record them rather than hiding them.

- [ ] **Step 3: Re-run the performance gate on a production Next server**

Build first, then start the already-built app on 127.0.0.1:3100 without the
Playwright development webServer. Use the Task 7 environment overrides to point
the existing config at that origin and run only the named 30-sample performance
test. Expected: exactly 30 entries and p95 below 16ms. Stop the exact server
PID/session afterward. Do not kill by broad process name.

Use these exact commands, running the server in a managed PTY/session and
sending Ctrl-C to that same session after the test:

```bash
pnpm run build:next
pnpm exec next start --hostname 127.0.0.1 --port 3100
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test tests/e2e/photo-compositor.spec.ts --config=playwright.config.ts --grep "keeps natural placement below 16ms p95 in the browser"
```

- [ ] **Step 4: Capture fresh visual evidence at both viewports**

Use the installed project-tested Chromium executable and the `playwright` skill.
At 1440x900 and 1280x800 capture seed, completed six-product redesign, explicit
arrangement, and post-Undo states into the exact paths above, overwriting stale
Task 4 images. Inspect every screenshot directly rather than inferring quality
from DOM values.

For each viewport verify:

- the rug lies on the calibrated floor instead of rising like furniture;
- sofa/table/chair footprints read as one seating group without collision;
- the window access path remains visibly clear;
- rug > sofa > table > narrow accessory relative sizing remains credible;
- all five contact shadows meet their registered floor anchors;
- rug and shadows are below the correct product pixels;
- selection frame, clipped rug hit area, floor marker, and rotation handle align;
- Arrange naturally/status/Undo do not shift or overlap the stage/composer; and
- the page console has zero application warning/error and cart interaction
  causes no external write.

- [ ] **Step 5: Perform independent spec and code review**

Review the full diff from main and specifically compare it with:

```text
docs/superpowers/specs/2026-09-01-nook-photo-compositor-design.md
docs/superpowers/specs/nook-natural-placement-design.md
docs/superpowers/specs/nook-hybrid-image-renderer-design.md
```

Require no unresolved Important or higher finding. Any code finding returns to
the owning task with a new RED test and reviewable fix commit. Any visual finding
requires refreshed screenshots and re-running affected focused/full gates.

- [ ] **Step 6: Update the handoff only after every gate is green**

Replace stale counts and pre-review claims in `docs/NEXT_SESSION.md`. Record:

- exact feature HEAD and commit subjects;
- automatic/manual placement semantics and one-Undo boundary;
- Core 6 cardinality and command/revision/stateVersion invariants;
- locked/no-op/failure behavior;
- rug metadata/projection and contact-shadow behavior;
- focused/full test counts and all command outcomes;
- production p95 duration;
- both viewport evidence paths and direct observations;
- known upstream-only warnings;
- no merge/push/deploy and untouched main `.pnpm-store/`; and
- that the next permitted step is Task 5, the time-boxed WebGPU spike in
  `docs/superpowers/plans/2026-09-02-nook-hybrid-image-renderer.md`, only if this
  review is green.

- [ ] **Step 7: Commit the verified handoff**

```bash
git add docs/NEXT_SESSION.md
git diff --cached --check
git commit -m "docs(photo): record natural placement verification"
git status --short
```

Expected: the handoff commit succeeds and the feature worktree is clean. Do not
merge, push, deploy, or begin the WebGPU spike; report results and next choices
to the user.
