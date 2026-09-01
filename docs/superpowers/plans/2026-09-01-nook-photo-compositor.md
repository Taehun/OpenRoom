# Nook Photo Compositor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Nook's WebGL room with an accessible 16:9 room-photo editor whose six photorealistic DOM cutouts remain backed by the existing Scene JSON, Zustand store, command layer, undo history, and WebMCP Core 6.

**Architecture:** A pure calibrated projection module maps canonical room-space `(x, z)` coordinates to normalized photo-stage coordinates. `RoomPhotoStage` renders one bottom-anchored DOM control per Scene object and keeps pointer previews local until it commits exactly one existing `commitTransform` command. Static, versioned room and cutout assets are resolved through an asset registry; product replacement updates only `assetId` and the existing product metadata.

**Tech Stack:** Next.js 16.3.3 App Router, React 19.2.8, TypeScript 5, Zustand 5, Zod 4, CSS Modules, Vitest, React Testing Library, Playwright, static WebP/PNG assets.

**Spec:** `docs/superpowers/specs/2026-09-01-nook-photo-compositor-design.md`

## Global Constraints

- Before editing React, Next image, CSS, or test code, read the relevant local Next 16.3.3 guides in `node_modules/next/dist/docs/`; do not rely on remembered Next.js APIs.
- Preserve `Scene` as the sole persisted model. Local component state may contain only an active pointer preview, never a second room or object store.
- Commit human move/rotation through `SceneStoreState.commitTransform`; commit replacement through the existing `replace` command. Do not mutate Scene objects directly.
- Preserve object IDs, Scene revision semantics, monotonic `stateVersion`, locks, selection, undo/reset, Core 6 tool names, structured tool results, and approval-only cart behavior.
- Keep `oak-frame-table`, `travertine-plinth-table`, and `walnut-nesting-table` as the first three coffee-table results in that order so the existing “second result” journey remains stable.
- Generate assets once during implementation, visually inspect them, and commit them. The application must make no runtime image-generation or asset-download call.
- Remove Three.js, React Three Fiber, and Drei without unrelated dependency upgrades.
- Do not implement the local Claude MCP companion in this plan; that is covered by `docs/superpowers/plans/2026-09-01-nook-local-mcp-companion.md`.
- Leave the branch unmerged and unpushed after implementation.

## File Map

Create:

- `src/features/photo/photo-calibration.ts` — versioned room-photo calibration.
- `src/features/photo/photo-projection.ts` — pure project/inverse-project/layer functions.
- `src/features/photo/photo-assets.ts` — typed registry for background, six seeds, and eighteen products.
- `src/features/photo/photo-object-layer.tsx` — one selectable, draggable cutout.
- `src/features/photo/room-photo-stage.tsx` — background, layers, selection clearing, and pointer orchestration.
- `tests/unit/photo-projection.test.ts`
- `tests/unit/photo-assets.test.ts`
- `tests/unit/room-photo-stage.test.tsx`
- `tests/e2e/photo-compositor.spec.ts`
- `public/demo/photo/nook-room-empty.webp`
- `public/demo/photo/nook-room-before.webp`
- `public/demo/photo/seed/*.webp`
- `public/demo/photo/products/*.webp`

Modify:

- `src/demo/demo-scene.ts` — attach six seed `assetId` values only to the demo Scene.
- `src/features/demo/demo-data.ts` — expand deterministic catalog to eighteen products.
- `src/features/demo/room-canvas.tsx` — replace dynamic `SceneCanvas` and fake agent form with `RoomPhotoStage` and prompt guidance.
- `src/features/demo/demo-workspace.tsx` — remove fake agent mutation route and retain real tool context.
- `src/features/demo/context-panel.tsx` — show category-matched product alternatives and truthful activity guidance.
- `src/features/demo/demo-types.ts`
- `src/features/demo/demo-state.ts`
- `src/features/demo/demo-workspace.module.css`
- `src/features/scene/scene-commands.ts` — set a replacement object's `assetId` to the selected product ID.
- `tests/unit/demo-workspace.test.tsx`
- `tests/unit/initialization.test.ts`
- `tests/unit/scene-commands.test.ts`
- `tests/unit/webmcp-tools.test.ts`
- `tests/e2e/demo-workspace.spec.ts`
- `tests/e2e/webmcp-core.spec.ts`
- `README.md`
- `docs/NEXT_SESSION.md`
- `package.json`
- `pnpm-lock.yaml`

Delete:

- `src/features/scene/scene-canvas.tsx`
- `src/features/scene/scene-object.tsx`
- `src/features/scene/transform-gizmo.tsx`

---

### Task 1: Pure Photo Projection and Calibration

**Files:**

- Create: `src/features/photo/photo-calibration.ts`
- Create: `src/features/photo/photo-projection.ts`
- Create: `tests/unit/photo-projection.test.ts`

**Interfaces:**

- Consumes: `Scene["room"]`, Scene object `position[0]`/`position[2]`, normalized pointer coordinates.
- Produces: deterministic `projectRoomPoint`, `unprojectStagePoint`, `objectVisualWidth`, and `layerOrder` functions with no React or DOM dependency.

- [ ] **Step 1: Read the pinned Next.js guides before editing**

Run:

```bash
sed -n '1,240p' node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/01-getting-started/11-css.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md
```

Record any rule that affects client-component boundaries or CSS Modules in the task notes. Expected: all three local files exist and describe the installed Next 16.3.3 behavior.

- [ ] **Step 2: Write failing projection tests**

Create `tests/unit/photo-projection.test.ts` with explicit corner, center, inverse, clamping, width, and rug-layer cases:

```ts
import { describe, expect, it } from "vitest";
import { NOOK_PHOTO_CALIBRATION } from "../../src/features/photo/photo-calibration";
import {
  layerOrder,
  objectVisualWidth,
  projectRoomPoint,
  unprojectStagePoint,
} from "../../src/features/photo/photo-projection";

const room = { width: 6, depth: 4.8, height: 2.8 };

describe("photo projection", () => {
  it("projects and inverts the room center", () => {
    const projected = projectRoomPoint({ x: 0, z: 0 }, room);
    const restored = unprojectStagePoint(projected, room);
    expect(restored.x).toBeCloseTo(0, 5);
    expect(restored.z).toBeCloseTo(0, 5);
  });

  it("maps back and front room corners to calibrated floor limits", () => {
    expect(projectRoomPoint({ x: -3, z: -2.4 }, room)).toMatchObject({
      left: NOOK_PHOTO_CALIBRATION.backLeft.x,
      top: NOOK_PHOTO_CALIBRATION.backFloorY,
      scale: NOOK_PHOTO_CALIBRATION.minScale,
    });
    expect(projectRoomPoint({ x: 3, z: 2.4 }, room)).toMatchObject({
      left: NOOK_PHOTO_CALIBRATION.frontRight.x,
      top: NOOK_PHOTO_CALIBRATION.frontFloorY,
      scale: NOOK_PHOTO_CALIBRATION.maxScale,
    });
  });

  it("clamps pointer coordinates before inversion", () => {
    expect(unprojectStagePoint({ x: -2, y: 3 }, room)).toEqual({
      x: -3,
      z: 2.4,
    });
  });

  it("keeps rugs below furniture at the same depth", () => {
    expect(layerOrder("rug", 700)).toBeLessThan(layerOrder("sofa", 700));
  });

  it("clamps visual width derived from real dimensions", () => {
    expect(objectVisualWidth(0.05, 1)).toBe(8);
    expect(objectVisualWidth(8, 1.4)).toBe(58);
  });
});
```

- [ ] **Step 3: Run the targeted test and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/photo-projection.test.ts
```

Expected: FAIL because `src/features/photo/photo-calibration.ts` and `photo-projection.ts` do not exist.

- [ ] **Step 4: Define the versioned calibration**

Create `photo-calibration.ts` with a readonly shape and one explicit record:

```ts
export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface PhotoCalibration {
  version: 1;
  backLeft: NormalizedPoint;
  backRight: NormalizedPoint;
  frontLeft: NormalizedPoint;
  frontRight: NormalizedPoint;
  backFloorY: number;
  frontFloorY: number;
  minScale: number;
  maxScale: number;
}

export const NOOK_PHOTO_CALIBRATION: PhotoCalibration = {
  version: 1,
  backLeft: { x: 0.24, y: 0.54 },
  backRight: { x: 0.76, y: 0.54 },
  frontLeft: { x: 0.04, y: 0.94 },
  frontRight: { x: 0.96, y: 0.94 },
  backFloorY: 0.54,
  frontFloorY: 0.94,
  minScale: 0.62,
  maxScale: 1.18,
};
```

Calibration adjustments after the final background is generated are allowed only if the tests and record change together.

- [ ] **Step 5: Implement projection and inverse projection**

Implement clamped linear interpolation without DOM access:

```ts
export interface ProjectedPlacement extends NormalizedPoint {
  left: number;
  top: number;
  scale: number;
  zIndex: number;
}

export function projectRoomPoint(
  position: { x: number; z: number },
  room: Pick<SceneRoom, "width" | "depth">,
  calibration = NOOK_PHOTO_CALIBRATION,
): ProjectedPlacement;

export function unprojectStagePoint(
  point: NormalizedPoint,
  room: Pick<SceneRoom, "width" | "depth">,
  calibration = NOOK_PHOTO_CALIBRATION,
): { x: number; z: number };

export function objectVisualWidth(widthM: number, scale: number): number;
export function layerOrder(type: ProductCategory, zIndex: number): number;
```

Use `depth = clamp((z + room.depth / 2) / room.depth, 0, 1)`, interpolate floor left/right and floor Y at that depth, then interpolate X inside the visible floor span. Return percentages in `0..1`; the component converts them to CSS percentages. Use a rug bias of at least 100 stacking units and clamp visual width to `8..58` percent.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/photo-projection.test.ts
pnpm run typecheck
git diff --check
```

Expected: all commands pass.

Commit:

```bash
git add src/features/photo/photo-calibration.ts src/features/photo/photo-projection.ts tests/unit/photo-projection.test.ts
git commit -m "feat(photo): add calibrated room projection"
```

---

### Task 2: Static Assets, Seed Mapping, and Eighteen-Product Catalog

**Files:**

- Create: `src/features/photo/photo-assets.ts`
- Create: `tests/unit/photo-assets.test.ts`
- Create: `public/demo/photo/nook-room-empty.webp`
- Create: `public/demo/photo/nook-room-before.webp`
- Create: `public/demo/photo/seed/*.webp`
- Create: `public/demo/photo/products/*.webp`
- Modify: `src/demo/demo-scene.ts`
- Modify: `src/features/demo/demo-data.ts`
- Modify: `src/features/scene/scene-commands.ts`
- Modify: `tests/unit/scene-commands.test.ts`
- Modify: `tests/unit/webmcp-tools.test.ts`

**Interfaces:**

- Consumes: six fixed demo object IDs and all deterministic `DEMO_PRODUCTS` IDs.
- Produces: `PHOTO_ASSETS`, `NOOK_ROOM_BACKGROUND`, `NOOK_ROOM_BEFORE`, `getPhotoAsset()`, six seed asset IDs, and three searchable products for each supported category.

- [ ] **Step 1: Write failing asset and catalog tests**

Create `tests/unit/photo-assets.test.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDemoScene } from "../../src/demo/demo-scene";
import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import {
  NOOK_ROOM_BACKGROUND,
  PHOTO_ASSETS,
  getPhotoAsset,
} from "../../src/features/photo/photo-assets";

const categories = [
  "sofa", "coffee_table", "rug", "floor_lamp", "chair", "plant",
] as const;

describe("photo assets", () => {
  it("has three stable products for every category", () => {
    for (const category of categories) {
      expect(DEMO_PRODUCTS.filter((item) => item.category === category))
        .toHaveLength(3);
    }
    expect(DEMO_PRODUCTS.filter((item) => item.category === "coffee_table")
      .map((item) => item.id)).toEqual([
        "oak-frame-table",
        "travertine-plinth-table",
        "walnut-nesting-table",
      ]);
  });

  it("resolves every seed and catalog object to a checked-in file", () => {
    const objects = createDemoScene().objects;
    for (const object of objects) expect(getPhotoAsset(object)).not.toBeNull();
    for (const product of DEMO_PRODUCTS) {
      const asset = PHOTO_ASSETS[product.id];
      expect(asset).toBeDefined();
      expect(existsSync(join(process.cwd(), "public", asset.src))).toBe(true);
    }
    expect(existsSync(join(process.cwd(), "public", NOOK_ROOM_BACKGROUND)))
      .toBe(true);
  });
});
```

Add a Scene-command assertion:

```ts
expect(result.scene.objects.find(({ id }) => id === "table_01")?.assetId)
  .toBe("travertine-plinth-table");
```

- [ ] **Step 2: Run the targeted tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/photo-assets.test.ts tests/unit/scene-commands.test.ts tests/unit/webmcp-tools.test.ts
```

Expected: FAIL because the registry and files do not exist, the catalog has only three tables, and replacement does not update `assetId`.

- [ ] **Step 3: Generate and inspect the empty room assets**

Invoke the `imagegen` skill and read its `SKILL.md` before this step. Edit the current `public/demo/nook-room.png` with this exact intent:

```text
Create a high-resolution 16:9 photorealistic version of this exact room.
Remove every freestanding item: sofa, coffee table, rug, floor lamp, accent
chair, and potted plant. Preserve the architecture, windows, walls, floor,
camera position, perspective, and warm daylight exactly. The finished room is
empty, clean, and plausible, with no text and no new decor.
```

Save the empty result as `public/demo/photo/nook-room-empty.webp` at a minimum width of 1600 px. Generate `nook-room-before.webp` from the same room with all six dated seed items present. Inspect both with the local image viewer; reject warped windows, changed camera perspective, furniture remnants, or illegible edges.

- [ ] **Step 4: Generate and inspect the six dated seed cutouts**

Generate one transparent, lossless-alpha cutout per exact ID:

```text
seed-dated-sofa       overstuffed faded floral sofa
seed-glass-table      smoked-glass coffee table with dark ornate wood base
seed-pattern-rug      loud burgundy-and-gold traditional patterned rug
seed-brass-lamp       ornate polished-brass floor lamp with pleated shade
seed-vinyl-chair      bulky brown vinyl accent chair
seed-faux-plant       visibly artificial ficus in a glossy red-brown pot
```

Use this common prompt suffix for every seed:

```text
Isolated full object as a photorealistic furniture cutout, transparent
background, warm daylight from camera-left, front three-quarter view matching a
fixed living-room photograph, natural soft contact shadow retained inside the
alpha bounds, bottom-center floor anchor, no room, no text, no cropped edges.
```

Save under `public/demo/photo/seed/<asset-id>.webp`. Inspect alpha, full-object framing, consistent light direction, and bottom anchor.

- [ ] **Step 5: Generate and inspect the eighteen product cutouts**

Generate these exact IDs and style families, using the same common cutout suffix:

```text
Japandi:
  hinoki-low-sofa, oak-frame-table, woven-jute-rug,
  rice-paper-floor-lamp, ash-lounge-chair, ceramic-olive-tree
Modern organic:
  boucle-curve-sofa, travertine-plinth-table, wool-pebble-rug,
  linen-dome-lamp, boucle-barrel-chair, stone-planter-ficus
Mid-century:
  walnut-frame-sofa, walnut-nesting-table, geometric-flatweave-rug,
  brass-globe-lamp, cognac-sling-chair, teak-planter-palm
```

Save under `public/demo/photo/products/<product-id>.webp`. Every asset must show the named category unambiguously; rugs use a low floor perspective, plants include their full planter, and lamps include the full base and shade.

- [ ] **Step 6: Expand the deterministic catalog**

Keep the three existing coffee-table records and order. Add the remaining fifteen records with unique `variantId`, price, centimetre dimensions, style tags, color, material, and description. Order the complete array by category in the existing Scene order, but preserve coffee-table internal order. Required IDs are:

```ts
export const PRODUCT_IDS_BY_CATEGORY = {
  sofa: ["hinoki-low-sofa", "boucle-curve-sofa", "walnut-frame-sofa"],
  coffee_table: [
    "oak-frame-table",
    "travertine-plinth-table",
    "walnut-nesting-table",
  ],
  rug: ["woven-jute-rug", "wool-pebble-rug", "geometric-flatweave-rug"],
  floor_lamp: ["rice-paper-floor-lamp", "linen-dome-lamp", "brass-globe-lamp"],
  chair: ["ash-lounge-chair", "boucle-barrel-chair", "cognac-sling-chair"],
  plant: ["ceramic-olive-tree", "stone-planter-ficus", "teak-planter-palm"],
} as const;
```

Each category's three results must represent Japandi, modern organic, and mid-century in that order.

- [ ] **Step 7: Implement the typed asset registry and seed mapping**

Create `photo-assets.ts` with no filesystem access at runtime:

```ts
export interface PhotoAsset {
  id: string;
  src: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  anchorX: number;
  anchorY: number;
}

export const NOOK_ROOM_BACKGROUND = "/demo/photo/nook-room-empty.webp";
export const NOOK_ROOM_BEFORE = "/demo/photo/nook-room-before.webp";

export function getPhotoAsset(object: SceneObject): PhotoAsset | null {
  return object.assetId ? PHOTO_ASSETS[object.assetId] ?? null : null;
}
```

Declare `PHOTO_ASSETS` between the constants and `getPhotoAsset()` as one
explicit object literal containing all six seed keys and all eighteen product
keys. Every value contains the exact public path plus measured intrinsic width,
intrinsic height, and normalized bottom anchor; do not derive paths from
unvalidated runtime input.

In `createDemoScene()`, assign only these six mappings after `buildScene()` and before `SceneSchema.parse()`:

```ts
const SEED_ASSETS: Record<string, string> = {
  sofa_01: "seed-dated-sofa",
  table_01: "seed-glass-table",
  rug_01: "seed-pattern-rug",
  lamp_01: "seed-brass-lamp",
  chair_01: "seed-vinyl-chair",
  plant_01: "seed-faux-plant",
};
```

Do not change the general upload-room `buildScene()` behavior.

- [ ] **Step 8: Wire replacement assets through the command layer**

In the existing `replace` branch, immediately after setting `source`, assign:

```ts
object.source = "product";
object.assetId = request.command.product.id;
object.product = structuredClone(request.command.product);
```

This keeps both human preview and WebMCP replacement on the same command path.

- [ ] **Step 9: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/photo-assets.test.ts tests/unit/scene-commands.test.ts tests/unit/webmcp-tools.test.ts
pnpm run typecheck
git diff --check
```

Expected: all tests pass; asset registry contains 24 cutouts; all referenced files exist.

Commit:

```bash
git add public/demo/photo src/demo/demo-scene.ts src/features/demo/demo-data.ts src/features/photo/photo-assets.ts src/features/scene/scene-commands.ts tests/unit/photo-assets.test.ts tests/unit/scene-commands.test.ts tests/unit/webmcp-tools.test.ts
git commit -m "feat(photo): add room and furniture asset catalog"
```

---

### Task 3: Accessible DOM Cutout Stage and One-Command Transforms

**Files:**

- Create: `src/features/photo/photo-object-layer.tsx`
- Create: `src/features/photo/room-photo-stage.tsx`
- Create: `tests/unit/room-photo-stage.test.tsx`
- Modify: `src/features/demo/demo-workspace.module.css`

**Interfaces:**

- Consumes: live `scene`, `toolMode`, `selectObject`, `setTransforming`, `commitTransform`, projection functions, and asset registry.
- Produces: an `Editable room photo` region with accessible object buttons, local drag/rotate previews, a missing-asset fallback, and one command per completed gesture.

- [ ] **Step 1: Write failing component tests**

Use a real `SceneStoreProvider` and render `RoomPhotoStage`. Cover six initial controls, selection clearing, pointer commit count, cancellation, locked object, keyboard move/rotate, and fallback:

```tsx
it("commits one move when an unlocked cutout drag ends", async () => {
  const store = createSceneStore();
  const commit = vi.spyOn(store.getState(), "commitTransform");
  render(<SceneStoreProvider store={store}><RoomPhotoStage /></SceneStoreProvider>);

  const table = screen.getByRole("button", { name: /coffee table/i });
  fireEvent.pointerDown(table, { pointerId: 7, clientX: 500, clientY: 300 });
  fireEvent.pointerMove(table, { pointerId: 7, clientX: 560, clientY: 340 });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.pointerUp(table, { pointerId: 7, clientX: 560, clientY: 340 });
  expect(commit).toHaveBeenCalledTimes(1);
});

```

Add four separate complete tests after this example: dispatch `pointercancel`
and assert zero calls, seed a locked object and assert selection works without a
transform handle, click the stage element itself and assert selection becomes
`null`, and seed an unknown `assetId` and assert its labelled fallback remains a
selectable button.

- [ ] **Step 2: Run the component test and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/room-photo-stage.test.tsx
```

Expected: FAIL because the stage components do not exist.

- [ ] **Step 3: Implement one cutout layer**

`PhotoObjectLayer` must be a semantic button. Apply placement as inline CSS custom properties while keeping class names in the CSS Module:

```tsx
<button
  aria-label={label}
  aria-pressed={selected}
  className={selected ? styles.photoObjectSelected : styles.photoObject}
  data-object-id={object.id}
  disabled={false}
  onKeyDown={onKeyDown}
  onPointerDown={onPointerDown}
  style={{
    "--photo-left": `${placement.left * 100}%`,
    "--photo-top": `${placement.top * 100}%`,
    "--photo-scale": placement.scale,
    "--photo-width": `${visualWidth}%`,
    "--photo-rotation": `${(object.rotation[1] * 180) / Math.PI}deg`,
    zIndex: layerOrder(object.type, placement.zIndex),
  } as React.CSSProperties}
  type="button"
>
  {asset ? <img alt="" draggable={false} src={asset.src} /> : (
    <span role="img" aria-label={`${label} preview unavailable`}>{label}</span>
  )}
</button>
```

Do not use `next/image` for transformable transparent cutouts unless the installed local guide proves it supports the required absolute sizing without layout wrappers. The background may use CSS `background-image` because its path is a versioned local constant.

- [ ] **Step 4: Implement stage pointer state and exact commit boundary**

`RoomPhotoStage` reads store state directly. Keep only this transient shape:

```ts
interface TransformPreview {
  pointerId: number;
  objectId: string;
  position: Vec3;
  rotationY: number;
  changed: boolean;
}
```

On pointer down, select the object and call `setPointerCapture`. On pointer move, convert `clientX/clientY` to normalized stage coordinates from `getBoundingClientRect()`, inverse-project, and update only `TransformPreview`. On pointer up, call `commitTransform(objectId, preview.position, preview.rotationY)` once only when `changed`; then clear preview and `setTransforming(false)`. On `pointercancel`, clear without commit. Use the store command result to let existing clamping remain authoritative.

- [ ] **Step 5: Implement rotation and keyboard paths**

For an unlocked selected non-rug object:

- Move mode arrow step: `0.08 m`; Shift step: `0.24 m`.
- Rotate mode Left/Right step: `5°`; Shift step: `15°`.
- Enter/Space selects a focused object in any mode.
- Rug rotation is omitted from the UI but existing tool calls may still provide a rotation; do not alter tool contracts.

Each keyboard event calls `commitTransform` at most once. It must `preventDefault()` only for keys it handles.

- [ ] **Step 6: Add 16:9 photo-stage CSS**

Add CSS Module rules for:

```css
.photoStage { aspect-ratio: 16 / 9; position: relative; overflow: hidden; }
.photoObject { position: absolute; left: var(--photo-left); top: var(--photo-top); width: var(--photo-width); transform: translate(-50%, -100%) scale(var(--photo-scale)) rotate(var(--photo-rotation)); transform-origin: 50% 100%; touch-action: none; }
.photoObject img { display: block; width: 100%; height: auto; pointer-events: none; user-select: none; }
```

Add visible `:focus-visible`, selected outline, locked badge, floor-anchor, rotation handle, and reduced-motion rules. Preserve the existing desktop viewport policy.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/photo-projection.test.ts tests/unit/room-photo-stage.test.tsx
pnpm run typecheck
pnpm run lint
git diff --check
```

Expected: all commands pass; gesture tests prove zero preview writes and exactly one release command.

Commit:

```bash
git add src/features/photo/photo-object-layer.tsx src/features/photo/room-photo-stage.tsx src/features/demo/demo-workspace.module.css tests/unit/room-photo-stage.test.tsx
git commit -m "feat(photo): render editable DOM cutout stage"
```

---

### Task 4: Workspace Integration, Honest Prompt Guidance, and 3D Removal

**Files:**

- Modify: `src/features/demo/room-canvas.tsx`
- Modify: `src/features/demo/demo-workspace.tsx`
- Modify: `src/features/demo/context-panel.tsx`
- Modify: `src/features/demo/demo-types.ts`
- Modify: `src/features/demo/demo-state.ts`
- Modify: `src/features/demo/demo-workspace.module.css`
- Modify: `tests/unit/demo-state.test.ts`
- Modify: `tests/unit/demo-workspace.test.tsx`
- Modify: `tests/unit/initialization.test.ts`
- Modify: `tests/e2e/demo-workspace.spec.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Delete: `src/features/scene/scene-canvas.tsx`
- Delete: `src/features/scene/scene-object.tsx`
- Delete: `src/features/scene/transform-gizmo.tsx`

**Interfaces:**

- Consumes: `RoomPhotoStage`, the existing dispatch/store routes, selected object category, clipboard API, and native WebMCP lifecycle.
- Produces: photo-first workspace, category-aware human preview, copy-only agent prompt guidance, and a dependency graph with no WebGL packages.

- [ ] **Step 1: Read remaining pinned Next guides**

Run:

```bash
sed -n '1,240p' node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/02-guides/server-and-client-boundary.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/public-folder.md
```

Expected: no dynamic client-only WebGL import is required for the DOM stage.

- [ ] **Step 2: Replace obsolete assertions with failing photo-workspace assertions**

In component and E2E tests, replace checks for `Interactive 3D room`, `<canvas>`, and `Run Agent move` with:

```ts
expect(screen.getByRole("region", { name: "Editable room photo" })).toBeVisible();
expect(screen.getAllByRole("button", { name: /sofa|coffee table|rug|floor lamp|chair|plant/i })).toHaveLength(6);
expect(screen.queryByRole("button", { name: /run agent move/i })).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "Copy redesign prompt" })).toBeVisible();
```

Change initialization tests to assert:

```ts
expect(packageJson.dependencies).not.toHaveProperty("three");
expect(packageJson.dependencies).not.toHaveProperty("@react-three/fiber");
expect(packageJson.dependencies).not.toHaveProperty("@react-three/drei");
```

Add a test selecting the chair, opening alternatives, and seeing exactly the three chair products. Add a clipboard mock proving prompt copy changes no Scene revision or `stateVersion`.

- [ ] **Step 3: Run focused tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/demo-state.test.ts tests/unit/demo-workspace.test.tsx tests/unit/initialization.test.ts
```

Expected: FAIL because the workspace still renders 3D, the fake action exists, and 3D dependencies remain.

- [ ] **Step 4: Replace the canvas and fake agent form**

Remove the `next/dynamic` `SceneCanvas` import and render:

```tsx
<div aria-label="Editable room photo" className={styles.sceneViewport} role="region">
  <RoomPhotoStage onObjectSelected={() => dispatch({ type: "show-inspector" })} />
</div>
```

Change the badge to `Photo placement`. Replace the submit form with a guidance card containing this primary prompt verbatim:

```text
Redesign this room as a warm minimal Japandi interior. Replace every outdated
unlocked item with a coherent catalog result, keep the sofa on the left, and
leave a clear path to the windows. Read the latest scene after each change.
```

Also expose `Modern organic, soft neutral textures` and `Mid-century, warm walnut and brass` suggestions. `Copy redesign prompt` calls `navigator.clipboard.writeText`; it never invokes a descriptor or dispatches a Scene mutation. Show native WebMCP status as `Available` only when `document.modelContext?.registerTool` exists; local pairing status is added by the companion plan.

- [ ] **Step 5: Remove the fake reducer action and make products category-aware**

Remove `run-agent-move` from `DemoAction`, reducer, workspace route, Activity text, and tests. Filter products against the selected object's type:

```ts
const selectedObject = scene.objects.find(({ id }) => id === scene.selectedObjectId);
const alternatives = selectedObject
  ? DEMO_PRODUCTS.filter(({ category }) => category === selectedObject.type)
  : [];
```

Use the selected category in the panel heading and `aria-label`. Keep `preview-product` routed through the existing `replace` command; category mismatch remains guarded in the command layer. Replace fake completed activity with instructions that real agent actions appear through the active agent surface and Scene revision diagnostics.

- [ ] **Step 6: Remove 3D files and packages**

Use `apply_patch` to delete the three renderer files. Remove only these packages:

```bash
pnpm remove three @react-three/fiber @react-three/drei
```

Do not upgrade other lockfile entries. Verify no imports remain:

```bash
rg -n "three|@react-three|SceneCanvas|TransformGizmo" src tests package.json
```

Expected: no runtime imports or assertions remain; prose may mention the deliberate absence only in docs/tests.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/demo-state.test.ts tests/unit/demo-workspace.test.tsx tests/unit/initialization.test.ts tests/unit/register-tools.test.tsx
pnpm run typecheck
pnpm run lint
git diff --check
```

Expected: all commands pass and native WebMCP registration/cleanup tests remain green.

Commit:

```bash
git add package.json pnpm-lock.yaml src/features/demo src/features/scene tests/unit/demo-state.test.ts tests/unit/demo-workspace.test.tsx tests/unit/initialization.test.ts tests/e2e/demo-workspace.spec.ts
git commit -m "refactor(demo): replace 3D room with photo editor"
```

---

### Task 5: Whole-Room Core 6 Journey, Browser QA, and Documentation

**Files:**

- Create: `tests/e2e/photo-compositor.spec.ts`
- Modify: `tests/e2e/demo-workspace.spec.ts`
- Modify: `tests/e2e/webmcp-core.spec.ts`
- Modify: `tests/unit/demo-workspace.test.tsx`
- Modify: `README.md`
- Modify: `docs/NEXT_SESSION.md`

**Interfaces:**

- Consumes: the completed photo stage, deterministic eighteen-product catalog, captured native WebMCP descriptors, and existing cart approval UI.
- Produces: browser evidence that human and agent operations affect the same Scene exactly once, plus accurate setup and architecture documentation.

- [ ] **Step 1: Add a failing whole-room Core 6 browser journey**

Extend the init script that captures `document.modelContext.registerTool` descriptors. Drive only captured Core 6 tools:

```ts
const scene = await callTool("get_scene", {});
let revision = scene.structuredContent.sceneRevision;
let stateVersion = scene.structuredContent.stateVersion;

for (const [objectId, category] of [
  ["sofa_01", "sofa"],
  ["table_01", "coffee_table"],
  ["rug_01", "rug"],
  ["lamp_01", "floor_lamp"],
  ["chair_01", "chair"],
  ["plant_01", "plant"],
] as const) {
  const search = await callTool("search_products", { category, limit: 3 });
  const productId = search.structuredContent.data.results[1].id;
  const replaced = await callTool("replace_object", {
    objectId, productId, expectedRevision: revision, expectedStateVersion: stateVersion,
  });
  expect(replaced.structuredContent.ok).toBe(true);
  revision = replaced.structuredContent.sceneRevision;
  stateVersion = replaced.structuredContent.stateVersion;
}
expect(revision).toBe(scene.structuredContent.sceneRevision + 6);
```

Assert all six DOM layers now reference the chosen product asset IDs, exactly six product-backed objects exist, and no generic tool was registered.

- [ ] **Step 2: Add human transform, stale move, and cart assertions**

Browser tests must prove:

- Dragging one unlocked cutout changes its diagnostic coordinate and increments revision once.
- Undo restores the exact prior coordinate and cutout location.
- A stale `move_object` returns `SCENE_REVISION_CONFLICT` and leaves the DOM `style` and Scene diagnostics unchanged.
- `add_scene_to_cart` opens the approval sheet with six chosen products.
- Route all page requests and assert the cart journey emits zero external requests.
- Navigating away aborts all six native registrations.

- [ ] **Step 3: Run browser tests and record RED/GREEN**

Run before completing assertions to capture RED, then finish implementation and rerun:

```bash
pnpm run test:e2e -- tests/e2e/photo-compositor.spec.ts tests/e2e/webmcp-core.spec.ts tests/e2e/demo-workspace.spec.ts
```

Expected RED: missing whole-room assertions or selectors. Expected GREEN: all named specs pass in Chromium.

- [ ] **Step 4: Perform visual and accessibility QA**

Run the app and inspect at 1440×900 and 1280×800:

```bash
pnpm run dev
```

Verify with a real browser:

- Room is 16:9 with no scroll-jumping during selection.
- All six old objects are visibly mismatched but share perspective and light direction.
- Product cutouts have clean alpha edges and convincing bottom anchors.
- Focus rings, object rail, keyboard move/rotate, selection clearing, undo, reset, and cart dialog work without pointer input.
- Missing-asset fallback remains selectable and labelled.
- Browser console has no hydration, image, WebMCP, or React warning.

Stop the dev server after inspection.

- [ ] **Step 5: Update documentation**

Update `README.md` and `docs/NEXT_SESSION.md` with:

- photo compositor architecture and static asset inventory,
- `Scene`/command-layer invariants,
- eighteen deterministic products and stable second-table behavior,
- native ChatGPT Work/Codex WebMCP path,
- truthful note that prompt copy is guidance, not in-page model execution,
- removal of Three/R3F/Drei,
- exact verification commands and current branch/commit once known.

Do not document the local Claude bridge as implemented until its separate plan is complete.

- [ ] **Step 6: Run the full verification matrix**

Run in this order and stop at the first failure:

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

Expected:

- all unit/component/E2E tests pass,
- vinext and Next webpack builds succeed,
- status shows only intended Task 5 documentation/test edits,
- no Three.js dependency or WebGL canvas remains.

- [ ] **Step 7: Commit the verified journey and docs**

```bash
git add tests/e2e/photo-compositor.spec.ts tests/e2e/demo-workspace.spec.ts tests/e2e/webmcp-core.spec.ts tests/unit/demo-workspace.test.tsx README.md docs/NEXT_SESSION.md
git diff --cached --check
git commit -m "test(photo): verify whole-room redesign journey"
```

- [ ] **Step 8: Final branch audit**

Run:

```bash
git status --short
git log --oneline --decorate -5
git diff main...HEAD --stat
```

Expected: clean worktree, five reviewable photo-compositor commits, and no merge or push.
