# Nook Deterministic Scene Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static Nook demo room with a real revision-aware Scene JSON, shared Zustand command layer, and editable React Three Fiber workspace.

**Architecture:** Domain code validates and mutates plain Scene JSON without React or Three.js. A Zustand vanilla store owns the canonical Scene, selection, tool mode, transform transaction, and 30-entry history. React context exposes that store to the existing Spatial Atelier UI, while React Three Fiber renders only what the store contains and commits TransformControls changes once on release.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod 4, Zustand 5, Three.js 0.185, React Three Fiber 9, drei 10, Vitest, React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-nook-scene-core-spec.md`

## Global Constraints

- Scene coordinates and dimensions use meters; catalog dimensions enter as centimetres and are converted once at the command boundary.
- Scene revision starts at `1`; successful style/preserve/replace/move commands increment it exactly once.
- Selection and tool-mode changes are revision-neutral.
- Reset restores a deep-cloned canonical seed, selection `table_01`, revision `1`, empty history, and Select mode.
- Human UI mutations must call the Scene store command layer; components must not mutate Three.js objects as persistent state.
- TransformControls preview locally while dragging and commit one move command on release.
- `/demo` remains deterministic and performs no network, Shopify, Tripo, WebMCP, R2, or D1 call.
- Preserve the approved Spatial Atelier layout and minimum `1280 × 720` desktop viewport.
- Keep the cart at exactly four items and `$626 USD`; confirmation creates no external cart.
- Do not add or upgrade dependencies; preserve `pnpm-lock.yaml`.

---

### Task 1: Deterministic Scene Domain and Room Engine

**Files:**
- Create: `src/features/scene/scene-schema.ts`
- Create: `src/features/scene/scene-commands.ts`
- Create: `src/features/room/room-analysis-schema.ts`
- Create: `src/features/room/room-engine.ts`
- Create: `src/demo/demo-scene.ts`
- Test: `tests/unit/room-engine.test.ts`
- Test: `tests/unit/scene-commands.test.ts`

**Interfaces:**
- Consumes: Zod only.
- Produces: `SceneSchema`, `RoomAnalysisSchema`, `createDemoScene(): Scene`, `buildScene(analysis: RoomAnalysis, widthM: number): Scene`, `applySceneCommand(scene: Scene, request: CommandRequest): CommandResult`, and the exact domain types exported from `scene-schema.ts`.

- [ ] **Step 1: Write failing Room Engine tests**

Create literal fixtures that prove:

```ts
const scene = buildScene(
  {
    roomType: "living_room",
    estimatedAspectRatio: 1.5,
    openings: [{ kind: "window", wall: "back", offset: 0.62 }],
    objects: [
      { type: "sofa", anchor: "left-wall", confidence: 0.91 },
      { type: "coffee_table", anchor: "center", confidence: 0.86 },
      { type: "plant", anchor: "back-right", confidence: 0.54 },
    ],
  },
  6,
);

expect(scene.room).toEqual({ width: 6, height: 2.5, depth: 4 });
expect(scene.revision).toBe(1);
expect(scene.objects.map((object) => object.type)).toEqual([
  "sofa",
  "coffee_table",
]);
expect(scene.objects.every(isInsideRoomByPointOneMetres)).toBe(true);
expect(aabbOverlaps(scene.objects[0], scene.objects[1])).toBe(false);
```

Add a second test with width `20` and aspect ratio `0.1`; expect width and depth to clamp to `8`. Assert every generated non-rug object has `position[1] === dimensionsM.height / 2` and each rug has `position[1] === 0.01`.

- [ ] **Step 2: Write failing command tests**

Use `createDemoScene()` and hand-authored requests to prove:

```ts
const replaced = applySceneCommand(seed, {
  expectedRevision: 1,
  actor: "human",
  command: {
    type: "replace",
    objectId: "table_01",
    product: LIGHT_OAK_TABLE,
  },
});

expect(replaced.ok).toBe(true);
if (replaced.ok) {
  const table = replaced.scene.objects.find(({ id }) => id === "table_01")!;
  expect(table.position[0]).toBe(seedTable.position[0]);
  expect(table.position[2]).toBe(seedTable.position[2]);
  expect(table.position[1]).toBe(0.2);
  expect(table.rotation).toEqual(seedTable.rotation);
  expect(table.dimensionsM).toEqual({ width: 1.05, height: 0.4, depth: 0.55 });
  expect(table.product?.id).toBe("oak-frame-table");
  expect(replaced.scene.revision).toBe(2);
}
```

Add independent tests for `SCENE_REVISION_CONFLICT`, `OBJECT_LOCKED`, `CATEGORY_MISMATCH`, move boundary adjustment, style intent, and preserve/unpreserve. A move request to `{ x: 99, z: -99 }` must succeed with `adjustedToFit: true` and an in-bounds applied position.

- [ ] **Step 3: Run targeted tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/room-engine.test.ts tests/unit/scene-commands.test.ts
```

Expected: FAIL because the new modules and exports do not exist.

- [ ] **Step 4: Implement Zod schemas and exported domain types**

`scene-schema.ts` must export:

```ts
export type Vec3 = [number, number, number];
export type ToolMode = "select" | "move" | "rotate";
export type SceneObjectType =
  | "sofa"
  | "coffee_table"
  | "rug"
  | "floor_lamp"
  | "chair"
  | "plant"
  | "unknown";

export interface DimensionsM {
  width: number;
  height: number;
  depth: number;
}

export interface SceneProduct {
  id: string;
  variantId: string;
  title: string;
  category: Exclude<SceneObjectType, "unknown">;
  price: { amountMinor: number; currency: "USD" };
  dimensionsCm: { width: number; height: number; depth: number };
  styleTags: string[];
  color: string | null;
  material: string | null;
}
```

Define and export `SceneObject`, `Scene`, `SceneCommand`, `CommandRequest`, `CommandResult`, `SceneSchema`, and `SceneProductSchema`. `SceneCommand` contains `set-style`, `preserve`, `replace`, and `move`. Error codes are `OBJECT_NOT_FOUND`, `OBJECT_LOCKED`, `CATEGORY_MISMATCH`, and `SCENE_REVISION_CONFLICT`.

- [ ] **Step 5: Implement deterministic generation**

Use these category dimensions in metres:

```ts
const CATEGORY_DIMENSIONS = {
  sofa: { width: 2, height: 0.85, depth: 0.9 },
  coffee_table: { width: 1.2, height: 0.42, depth: 0.6 },
  rug: { width: 2.4, height: 0.02, depth: 1.7 },
  floor_lamp: { width: 0.35, height: 1.6, depth: 0.35 },
  chair: { width: 0.8, height: 0.85, depth: 0.8 },
  plant: { width: 0.55, height: 1.2, depth: 0.55 },
  unknown: { width: 1, height: 1, depth: 1 },
} as const;
```

Map `center` to `[0, y, 0]`, `left-wall` to the left inset, `right-wall` to the right inset, `back-left`/`back-right` to the corresponding back corner inset, and unknown anchors to centre. Resolve only the initial sofa/table overlap by moving the table toward positive Z in `0.1m` increments, then clamp every object to the room.

- [ ] **Step 6: Implement pure commands**

Commands clone the incoming Scene, validate expected revision and object/category/lock state, apply one mutation, validate with `SceneSchema`, and return the untouched original Scene on failure. Convert degrees to radians at the move boundary. Replacement normalizes Y from the new height and sets `source: "product"`, `product`, and `addedBy` from the actor.

- [ ] **Step 7: Implement the canonical seed**

`createDemoScene()` returns a new validated living-room Scene on every call with IDs `sofa_01`, `table_01`, `rug_01`, `lamp_01`, `chair_01`, and `plant_01`; selected object is `table_01`; source is `demo`; revision is `1`; style intent is `null`.

- [ ] **Step 8: Run tests, typecheck, and commit**

Run:

```bash
pnpm exec vitest run tests/unit/room-engine.test.ts tests/unit/scene-commands.test.ts
pnpm run typecheck
```

Commit:

```bash
git add src/features/scene src/features/room src/demo/demo-scene.ts tests/unit/room-engine.test.ts tests/unit/scene-commands.test.ts
git commit -m "feat(scene): add deterministic room and command core"
```

---

### Task 2: Zustand Scene Store and History

**Files:**
- Create: `src/features/scene/scene-store.ts`
- Test: `tests/unit/scene-store.test.ts`

**Interfaces:**
- Consumes: `Scene`, `Vec3`, `ToolMode`, `CommandRequest`, `CommandResult`, `applySceneCommand`, and `createDemoScene` from Task 1.
- Produces: `SceneStoreState`, `SceneStore`, and `createSceneStore(seed?: Scene): SceneStore` using `zustand/vanilla`.

- [ ] **Step 1: Write failing store tests**

Cover these observable sequences against the real vanilla store:

```ts
const store = createSceneStore();
store.getState().selectObject("chair_01");
expect(store.getState().scene.selectedObjectId).toBe("chair_01");
expect(store.getState().scene.revision).toBe(1);

const result = store.getState().applyCommand({
  expectedRevision: 1,
  actor: "human",
  command: { type: "preserve", objectId: "sofa_01", preserved: true },
});
expect(result.ok).toBe(true);
expect(store.getState().scene.revision).toBe(2);
expect(store.getState().history).toHaveLength(1);
expect(store.getState().undo()).toBe(true);
expect(store.getState().scene.revision).toBe(1);
```

Add tests proving stale commands do not add history, 35 successful style commands retain exactly 30 snapshots, `commitTransform` adds one revision/history entry, and reset restores a fresh canonical seed with Select mode and `isTransforming: false`.

- [ ] **Step 2: Run targeted test and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/scene-store.test.ts
```

Expected: FAIL because `scene-store.ts` does not exist.

- [ ] **Step 3: Implement the vanilla store**

Use `createStore<SceneStoreState>()`. State shape:

```ts
export interface SceneStoreState {
  scene: Scene;
  canonicalSeed: Scene;
  history: Scene[];
  toolMode: ToolMode;
  isTransforming: boolean;
  selectObject(objectId: string | null): void;
  setToolMode(mode: ToolMode): void;
  setTransforming(isTransforming: boolean): void;
  applyCommand(request: CommandRequest): CommandResult;
  commitTransform(objectId: string, position: Vec3, rotationY?: number): CommandResult;
  undo(): boolean;
  reset(): void;
}
```

Deep-clone Scenes with `structuredClone`. `applyCommand` calls only `applySceneCommand`; on success it appends the previous Scene, slices the last 30 entries, and stores the result Scene. `commitTransform` builds a human `move` command with the current revision. Undo restores the last snapshot without inventing a new revision.

- [ ] **Step 4: Run store and domain tests**

Run:

```bash
pnpm exec vitest run tests/unit/room-engine.test.ts tests/unit/scene-commands.test.ts tests/unit/scene-store.test.ts
pnpm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/features/scene/scene-store.ts tests/unit/scene-store.test.ts
git commit -m "feat(scene): add shared Zustand command store"
```

---

### Task 3: Store-backed Workspace UI

**Files:**
- Create: `src/features/scene/scene-context.tsx`
- Modify: `src/features/demo/demo-types.ts`
- Modify: `src/features/demo/demo-state.ts`
- Modify: `src/features/demo/demo-data.ts`
- Modify: `src/features/demo/demo-workspace.tsx`
- Modify: `src/features/demo/workspace-header.tsx`
- Modify: `src/features/demo/room-canvas.tsx`
- Modify: `src/features/demo/context-panel.tsx`
- Test: `tests/unit/demo-state.test.ts`
- Test: `tests/unit/demo-workspace.test.tsx`

**Interfaces:**
- Consumes: `createSceneStore`, `SceneStore`, `SceneStoreState`, `Scene`, `SceneObject`, and `SceneProduct` from Tasks 1-2.
- Produces: `SceneStoreProvider`, `useSceneStore<T>(selector)`, UI-only `DemoState`, and a workspace in which every spatial/design mutation reaches `SceneStoreState` actions.

- [ ] **Step 1: Rewrite tests first around the shared Scene**

Update reducer tests so `DemoState` owns only `mode`, `isCartOpen`, `toast`, and `announcement`. Add component tests that prove:

- clicking `Chair` updates the inspector to `Lounge chair` without changing revision;
- previewing `Oak Frame Table` changes `table_01` to product source, revision `2`, and room total `$169`;
- `Run Agent move` changes `lamp_01` position and revision exactly once;
- Undo restores the previous Scene;
- Reset restores selected `table_01`, revision `1`, total `$0`, inspector mode, and closed cart.

Expose only user-visible assertions plus a `<output aria-label="Scene diagnostics">` string formatted `Revision N · selectedId · productId-or-placeholder`.

- [ ] **Step 2: Run component tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/demo-state.test.ts tests/unit/demo-workspace.test.tsx
```

Expected: FAIL because the existing reducer still owns Scene-like state and no Scene provider exists.

- [ ] **Step 3: Implement React store context**

Create one store per provider with `useRef(createSceneStore())`; expose the vanilla store through React Context and select state through Zustand's `useStore`. Throw `SceneStoreProvider is missing` when the hook is used outside the provider.

- [ ] **Step 4: Make the reducer UI-only**

Keep actions for inspector/products/activity/cart/confirmation/toast/reset. Remove revision, selected object, preview product, provider, room total, and history from `DemoState`. Scene actions are intercepted in `DemoWorkspace` and delegated to the Scene store; the UI reducer only changes panels, disclosure, and toast.

- [ ] **Step 5: Add product-compatible fixtures**

Extend the three deterministic product fixtures with category, variant, centimetre dimensions, style tags, color, and material. Keep exact names/prices and keep `CART_ITEMS` unchanged. `Oak Frame Table` dimensions are `105 × 40 × 55cm`.

- [ ] **Step 6: Bind the existing UI to Scene state**

Derive provider (`Cached` when a product exists, otherwise `Demo fallback`), room total, revision, selection, inspector dimensions/position/rotation, and preview label from the canonical Scene. The object rail calls `selectObject`; preview calls a `replace` command; Agent move reads the current lamp position and commits `x - 0.42`; Undo and Reset call the store.

- [ ] **Step 7: Run component/domain tests and commit**

Run:

```bash
pnpm run test
pnpm run typecheck
pnpm run lint
```

Commit:

```bash
git add src/features/scene/scene-context.tsx src/features/demo tests/unit
git commit -m "feat(demo): connect the workspace to shared Scene state"
```

---

### Task 4: React Three Fiber Room and Transform Controls

**Files:**
- Create: `src/features/scene/scene-canvas.tsx`
- Create: `src/features/scene/scene-object.tsx`
- Create: `src/features/scene/transform-gizmo.tsx`
- Modify: `src/features/demo/room-canvas.tsx`
- Modify: `src/features/demo/demo-workspace.module.css`
- Modify: `tests/e2e/demo-workspace.spec.ts`
- Test: `tests/unit/demo-workspace.test.tsx`

**Interfaces:**
- Consumes: `SceneStoreProvider`, `useSceneStore`, Scene objects, tool mode, `commitTransform`, `setTransforming`, and selection from Tasks 1-3.
- Produces: an actual R3F `<canvas data-testid="scene-canvas">`, semantic primitive room objects, mesh selection, OrbitControls, and commit-on-release TransformControls.

- [ ] **Step 1: Add failing renderer integration assertions**

Component tests must assert a lazy scene loading region named `Interactive 3D room` exists and the accessible object list remains available. Update Playwright to require `canvas[data-testid="scene-canvas"]`, select `Chair`, activate `Move tool`, preview Oak Frame Table, run Agent move, undo, reset, and complete the existing cart flow with zero console errors at `1280 × 720`.

- [ ] **Step 2: Run targeted tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/demo-workspace.test.tsx
pnpm exec playwright test tests/e2e/demo-workspace.spec.ts --config=playwright.config.ts
```

Expected: FAIL because the workspace still renders the static image and Move/Rotate are disabled.

- [ ] **Step 3: Implement semantic primitive objects**

Render each object at its Scene transform using category-specific primitives:

- sofa: low seat box plus back and arms;
- coffee table: top plus four legs;
- rug: thin box;
- floor lamp: cylinder stem plus sphere shade;
- chair: seat and back boxes;
- plant: pot cylinder plus leaf spheres;
- unknown: single box.

Use neutral category colors for placeholders and product `color` mappings for product-linked objects. Clicking any primitive group stops propagation and selects its object ID. The selected group receives a moss outline by rendering a slightly larger wireframe box from `dimensionsM`.

- [ ] **Step 4: Implement room, camera, and controls**

`SceneCanvas` renders floor, back wall, left wall, ambient light, directional light, `PerspectiveCamera makeDefault position={[6, 5, 7]}`, and OrbitControls targeting `[0, 0.7, 0]`. Canvas uses `dpr={[1, 1.5]}`, `shadows={false}`, and a limestone background. Empty-canvas click clears selection.

- [ ] **Step 5: Implement TransformControls transaction**

Attach TransformControls only when a non-rug object is selected and tool mode is Move or Rotate. Move mode is `translate` with `showY={false}`; Rotate mode is `rotate` with only Y enabled. On pointer-down cache the group's starting transform and set transforming true. During object change mutate only the group preview. On mouse-up read group position/rotation, restore React ownership through `commitTransform`, and set transforming false. OrbitControls `enabled` is `!isTransforming`.

- [ ] **Step 6: Replace the static image without changing the shell**

Dynamically load `SceneCanvas` with `ssr: false`. Preserve the canvas badge, selection label, toast, composer, tool rail, context panel, and desktop notice. Activate Move/Rotate buttons through `setToolMode`; visually and semantically expose `aria-pressed`. Keep the object list as the non-WebGL control path.

- [ ] **Step 7: Run the complete verification matrix**

Run:

```bash
pnpm run test
pnpm run test:e2e
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run build:next
git diff --check
```

Expected: all commands exit `0`; both builds include `/demo`; Playwright reports zero console errors.

- [ ] **Step 8: Commit**

```bash
git add src/features/scene src/features/demo tests/e2e/demo-workspace.spec.ts tests/unit/demo-workspace.test.tsx
git commit -m "feat(scene): render and edit the deterministic room in R3F"
```
