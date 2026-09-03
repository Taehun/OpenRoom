# OpenInterior Facing Vectors and Multi-View Cutouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every cutout a stored front vector, every Scene object a derived facing, render the truthful view (mirrored when useful) instead of tilting one picture, let the solver turn seating only toward truthful views while composing the room like a staged photo, and ship an offline gpt-image-1 pipeline that produces the missing views.

**Architecture:** A pure `photo-facing`/`photo-views` layer (vectors, registry sets, selection, fidelity, rotation options) feeds three consumers: the DOM compositor (view choice + mirroring), the WebMCP handlers (`facing` in outputs, `facing` input on `move_object`), and the placement solver (rotation options, fidelity and composition scoring, chair flanking, lamp adjacency). A `tsx` script with a pure core plans and performs `gpt-image-1` edits offline and writes a checked-in manifest that the registry merges.

**Tech Stack:** Next 16.3.3 App Router, React 19, Zustand, Zod 4, Vitest 4 (jsdom), Playwright 1.62, tsx, sharp (dev only), Node 24.13.1, pnpm 10.27.0.

**Spec:** `docs/superpowers/specs/2026-09-03-openinterior-facing-views-design.md`

## Global Constraints

- `rotation[1]` stays the single source of truth for orientation; `facing` is derived and never stored on the Scene (spec 2).
- No runtime image generation, no API key in the app, `ASSET_PROVIDER=cached` only; the script is never imported by the app, CI never runs it, the key lives only in `.env.local` and is never logged (spec 2, 9.4).
- WebMCP surface stays exactly the Core 6; `move_object` stays a one-object command (spec 2).
- Solver stays pure, deterministic, viewport-agnostic, under 16ms p95 on the reference machine, and never proposes an orientation without a truthful registered view (spec 2, 8.4).
- Rugs keep the floor homography and floor-plane rotation (spec 2).
- Canonical front vectors (spec 4.3): `front-quarter (0.5736, 0.8192)`, `side (1, 0)`, `back-quarter (0.5736, -0.8192)`, `back (0, -1)`; mirrored twin negates `x`.
- Symmetry (spec 4.4): sofa `none`, chair `none`, coffee_table `front-back`, floor_lamp `radial`, plant `radial`, rug `radial`, unknown `none`.
- Origin weights (spec 8.1): photographed `1.0`, generated `0.8`, mirrored candidate `× 0.95`; coverage cone `45°`.
- Score weights (spec 8.3), sum 10,000: circulation 2300, sofaWallAndSide 1500, tableRelation 1600, rugRelation 1400, chairRelation 1000, accessories 600, movement 400, viewFidelity 600, composition 600.
- Repository workflow (AGENTS.md): run the narrowest Vitest file first; before completion run `pnpm test`, `pnpm typecheck`, `pnpm lint`; `pnpm build:next` for build/runtime changes; `pnpm test:e2e` for browser-visible flows. Never deploy or call live providers.
- Port 3000 belongs to the owner's dev server (never stop it). For E2E in the worktree start `pnpm exec next dev --hostname 127.0.0.1 --port 3100` in the background and run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm test:e2e`; stop only the server you started.
- Do not edit generated output in `.next/`, `dist/`, `.vinext/`. Never rewrite history in the shared worktree (no amend, rebase, reset, stash).

---

### Task 1: Facing math, view registry, selection, fidelity, rotation options

**Files:**
- Create: `src/features/photo/photo-facing.ts`
- Create: `src/features/photo/photo-views.ts`
- Create: `src/features/photo/photo-views.generated.json`
- Modify: `src/features/photo/photo-assets.ts` (keep `PHOTO_ASSETS`; export `PhotoAsset` unchanged)
- Test: `tests/unit/photo-facing.test.ts`, `tests/unit/photo-views.test.ts`

**Interfaces:**
- Produces (used by Tasks 2, 3, 4, 5):

```ts
// photo-facing.ts
export interface FacingVector { x: number; z: number }
export type PhotoViewName = "front-quarter" | "side" | "back-quarter" | "back";
export const PHOTO_VIEW_NAMES: readonly PhotoViewName[]; // in the order above
export const FRONT_VECTORS: Readonly<Record<PhotoViewName, FacingVector>>;
export function facingOf(rotationY: number): FacingVector;
export function rotationYOf(facing: FacingVector): number;
export function normalizeFacing(v: { x: number; z: number }): FacingVector | null;
export function angleBetweenDegrees(a: FacingVector, b: FacingVector): number; // 0..180
export function roundFacing(f: FacingVector): FacingVector; // 4 decimals

// photo-views.ts
export type PhotoViewOrigin = "photographed" | "generated";
export type PhotoViewSymmetry = "none" | "front-back" | "radial";
export interface PhotoAssetView { view: PhotoViewName; frontVector: FacingVector; src: string; intrinsicWidth: number; intrinsicHeight: number; anchorX: number; anchorY: number; origin: PhotoViewOrigin }
export interface PhotoAssetSet { id: string; type: SceneObjectType; symmetry: PhotoViewSymmetry; views: readonly PhotoAssetView[]; floorQuad?: NormalizedQuad }
export const PHOTO_VIEW_SYMMETRY: Readonly<Record<SceneObjectType, PhotoViewSymmetry>>;
export const GeneratedViewManifestSchema: z.ZodType<GeneratedViewManifest>; // strict
export interface GeneratedViewEntry { assetId: string; view: Exclude<PhotoViewName, "front-quarter">; src: string; intrinsicWidth: number; intrinsicHeight: number; anchorX: number; anchorY: number; model: string; generatedAt: string }
export interface GeneratedViewManifest { version: 1; views: GeneratedViewEntry[] }
export function buildPhotoAssetSets(base: Record<string, PhotoAsset>, types: Record<string, SceneObjectType>, manifest: GeneratedViewManifest): Record<string, PhotoAssetSet>;
export const PHOTO_ASSET_SETS: Readonly<Record<string, PhotoAssetSet>>;
export function getPhotoAssetSet(object: Pick<SceneObject, "assetId">): PhotoAssetSet | null;
export interface SelectedPhotoView { view: PhotoAssetView; mirrored: boolean; frontVector: FacingVector; anchorX: number; angleDegrees: number; exact: boolean }
export function selectPhotoView(object: Pick<SceneObject, "position" | "rotation" | "type">, set: PhotoAssetSet): SelectedPhotoView;
export function viewFidelity(facing: FacingVector, set: PhotoAssetSet): number; // 0 when uncovered
export interface RotationOption { rotationY: number; fidelity: number }
export function rotationOptionsFor(object: Pick<SceneObject, "rotation" | "type" | "assetId">, set: PhotoAssetSet | null): readonly RotationOption[];
export function buildRotationOptions(scene: Scene): Readonly<Record<string, readonly RotationOption[]>>;
```

Asset types for the 24 base assets come from a `PHOTO_ASSET_TYPES: Record<string, SceneObjectType>` constant in `photo-views.ts` (seed ids map to their seed category: `seed-dated-sofa` sofa, `seed-glass-table` coffee_table, `seed-pattern-rug` rug, `seed-brass-lamp` floor_lamp, `seed-vinyl-chair` chair, `seed-faux-plant` plant; catalog ids use `DEMO_PRODUCTS[].category`).

- [ ] **Step 1: Write failing facing tests**

```ts
// tests/unit/photo-facing.test.ts
import { describe, expect, it } from "vitest";
import { FRONT_VECTORS, angleBetweenDegrees, facingOf, normalizeFacing, rotationYOf, roundFacing } from "../../src/features/photo/photo-facing";

describe("facing math", () => {
  it("faces the camera side at rotation 0", () => {
    expect(facingOf(0)).toEqual({ x: -0, z: 1 });
  });
  it("round-trips every 45° step through rotationYOf", () => {
    for (let k = -3; k <= 4; k += 1) {
      const yaw = (k * Math.PI) / 4;
      expect(rotationYOf(facingOf(yaw))).toBeCloseTo(yaw, 12);
    }
  });
  it("normalises rotationYOf into (-π, π]", () => {
    expect(rotationYOf(facingOf(Math.PI * 3))).toBeCloseTo(Math.PI, 12);
    expect(rotationYOf(facingOf(-Math.PI / 2))).toBeCloseTo(-Math.PI / 2, 12);
  });
  it("rejects zero-length and non-finite vectors", () => {
    expect(normalizeFacing({ x: 0, z: 0 })).toBeNull();
    expect(normalizeFacing({ x: 1e-7, z: 0 })).toBeNull();
    expect(normalizeFacing({ x: Number.NaN, z: 1 })).toBeNull();
    expect(normalizeFacing({ x: 3, z: 4 })).toEqual({ x: 0.6, z: 0.8 });
  });
  it("stores the canonical front vectors", () => {
    expect(FRONT_VECTORS["front-quarter"].x).toBeCloseTo(0.5736, 4);
    expect(FRONT_VECTORS["front-quarter"].z).toBeCloseTo(0.8192, 4);
    expect(FRONT_VECTORS.side).toEqual({ x: 1, z: 0 });
    expect(FRONT_VECTORS["back-quarter"].z).toBeCloseTo(-0.8192, 4);
    expect(FRONT_VECTORS.back).toEqual({ x: 0, z: -1 });
  });
  it("measures angles in degrees from 0 to 180", () => {
    expect(angleBetweenDegrees({ x: 0, z: 1 }, { x: 0, z: 1 })).toBe(0);
    expect(angleBetweenDegrees({ x: 0, z: 1 }, { x: 1, z: 0 })).toBeCloseTo(90, 9);
    expect(angleBetweenDegrees({ x: 0, z: 1 }, { x: 0, z: -1 })).toBeCloseTo(180, 9);
    expect(angleBetweenDegrees({ x: 0, z: 1 }, FRONT_VECTORS["front-quarter"])).toBeCloseTo(35, 1);
  });
  it("rounds to four decimals", () => {
    expect(roundFacing({ x: 0.57357643, z: 0.81915204 })).toEqual({ x: 0.5736, z: 0.8192 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/photo-facing.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `photo-facing.ts`**

```ts
import type { SceneObjectType } from "../scene/scene-schema";

export interface FacingVector { x: number; z: number }
export type PhotoViewName = "front-quarter" | "side" | "back-quarter" | "back";
export const PHOTO_VIEW_NAMES: readonly PhotoViewName[] = ["front-quarter", "side", "back-quarter", "back"];

const QUARTER = (35 * Math.PI) / 180;
export const FRONT_VECTORS: Readonly<Record<PhotoViewName, FacingVector>> = Object.freeze({
  "front-quarter": { x: Math.sin(QUARTER), z: Math.cos(QUARTER) },
  side: { x: 1, z: 0 },
  "back-quarter": { x: Math.sin(QUARTER), z: -Math.cos(QUARTER) },
  back: { x: 0, z: -1 },
});

export function facingOf(rotationY: number): FacingVector {
  return { x: -Math.sin(rotationY), z: Math.cos(rotationY) };
}

export function rotationYOf(facing: FacingVector): number {
  const yaw = Math.atan2(-facing.x, facing.z);
  return yaw <= -Math.PI ? yaw + Math.PI * 2 : yaw; // (-π, π]
}

export function normalizeFacing(v: { x: number; z: number }): FacingVector | null {
  if (!Number.isFinite(v.x) || !Number.isFinite(v.z)) return null;
  const length = Math.hypot(v.x, v.z);
  if (length < 1e-6) return null;
  return { x: v.x / length, z: v.z / length };
}

export function angleBetweenDegrees(a: FacingVector, b: FacingVector): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z));
  return (Math.acos(dot) * 180) / Math.PI;
}

export function roundFacing(f: FacingVector): FacingVector {
  const round = (n: number) => Math.round(n * 10_000) / 10_000 || 0;
  return { x: round(f.x), z: round(f.z) };
}
```

Note `facingOf(0)` yields `-0` for `x`; the first test accepts `-0` via `toEqual`. If Vitest distinguishes `-0`, use `expect(facingOf(0).x + 0).toBe(0)`.

- [ ] **Step 4: Run facing tests to pass**

Run: `pnpm vitest run tests/unit/photo-facing.test.ts` — Expected: PASS.

- [ ] **Step 5: Write failing view registry tests**

```ts
// tests/unit/photo-views.test.ts
import { describe, expect, it } from "vitest";
import { PHOTO_ASSETS } from "../../src/features/photo/photo-assets";
import { FRONT_VECTORS, facingOf } from "../../src/features/photo/photo-facing";
import {
  GeneratedViewManifestSchema, PHOTO_ASSET_SETS, PHOTO_VIEW_SYMMETRY, buildPhotoAssetSets,
  buildRotationOptions, getPhotoAssetSet, rotationOptionsFor, selectPhotoView, viewFidelity,
  type PhotoAssetSet,
} from "../../src/features/photo/photo-views";
import manifest from "../../src/features/photo/photo-views.generated.json";
import { createDemoScene } from "../../src/demo/demo-scene";

const sofaSet = () => PHOTO_ASSET_SETS["hinoki-low-sofa"]!;
const objectAt = (x: number, yaw: number, type: "sofa" | "chair" | "coffee_table" | "floor_lamp" = "sofa") =>
  ({ position: [x, 0.4, 0] as [number, number, number], rotation: [0, yaw, 0] as [number, number, number], type });

function withViews(set: PhotoAssetSet, views: Array<"side" | "back-quarter" | "back">): PhotoAssetSet {
  return {
    ...set,
    views: [
      ...set.views,
      ...views.map((view) => ({ ...set.views[0]!, view, frontVector: FRONT_VECTORS[view], origin: "generated" as const, src: `/x/${view}.webp` })),
    ],
  };
}

describe("photo view registry", () => {
  it("builds one set per base asset with a photographed front-quarter view", () => {
    expect(Object.keys(PHOTO_ASSET_SETS)).toHaveLength(Object.keys(PHOTO_ASSETS).length);
    for (const set of Object.values(PHOTO_ASSET_SETS)) {
      expect(set.views[0]).toMatchObject({ view: "front-quarter", origin: "photographed", frontVector: FRONT_VECTORS["front-quarter"] });
      expect(set.symmetry).toBe(PHOTO_VIEW_SYMMETRY[set.type]);
    }
    expect(PHOTO_ASSET_SETS["woven-jute-rug"]!.floorQuad).toBeDefined();
  });
  it("validates the checked-in manifest", () => {
    expect(GeneratedViewManifestSchema.safeParse(manifest).success).toBe(true);
  });
  it("rejects manifest entries for unknown assets, duplicates, and front-quarter", () => {
    const entry = { assetId: "hinoki-low-sofa", view: "side", src: "/demo/photo/products/hinoki-low-sofa--side.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5, anchorY: 0.9, model: "gpt-image-1", generatedAt: "2026-09-03T00:00:00.000Z" } as const;
    const types = { "hinoki-low-sofa": "sofa" } as const;
    const base = { "hinoki-low-sofa": PHOTO_ASSETS["hinoki-low-sofa"]! };
    expect(() => buildPhotoAssetSets(base, types, { version: 1, views: [{ ...entry, assetId: "nope" }] })).toThrow(/unknown asset/i);
    expect(() => buildPhotoAssetSets(base, types, { version: 1, views: [entry, entry] })).toThrow(/duplicate/i);
    expect(GeneratedViewManifestSchema.safeParse({ version: 1, views: [{ ...entry, view: "front-quarter" }] }).success).toBe(false);
    const built = buildPhotoAssetSets(base, types, { version: 1, views: [entry] });
    expect(built["hinoki-low-sofa"]!.views.map((v) => v.view)).toEqual(["front-quarter", "side"]);
    expect(built["hinoki-low-sofa"]!.views[1]).not.toHaveProperty("model");
  });
});

describe("selectPhotoView", () => {
  it("keeps the un-mirrored front-quarter for a rotation-0 object left of centre", () => {
    const pick = selectPhotoView(objectAt(-1.7, 0), sofaSet());
    expect(pick).toMatchObject({ mirrored: false, exact: true });
    expect(pick.angleDegrees).toBeCloseTo(35, 1);
    expect(pick.anchorX).toBe(sofaSet().views[0]!.anchorX);
  });
  it("mirrors the front-quarter for a rotation-0 object right of centre", () => {
    const pick = selectPhotoView(objectAt(1.8, 0), sofaSet());
    expect(pick.mirrored).toBe(true);
    expect(pick.frontVector.x).toBeLessThan(0);
    expect(pick.anchorX).toBeCloseTo(1 - sofaSet().views[0]!.anchorX, 12);
  });
  it("uses the native view for a right-turned object anywhere", () => {
    expect(selectPhotoView(objectAt(1.8, -Math.PI / 4), sofaSet()).mirrored).toBe(false);
    expect(selectPhotoView(objectAt(-1.8, Math.PI / 4), sofaSet()).mirrored).toBe(true);
  });
  it("marks a 90° turn approximate without a side view and exact with one", () => {
    expect(selectPhotoView(objectAt(0, Math.PI / 2), sofaSet()).exact).toBe(false);
    const pick = selectPhotoView(objectAt(0, -Math.PI / 2), withViews(sofaSet(), ["side"]));
    expect(pick).toMatchObject({ mirrored: false, exact: true });
    expect(pick.view.view).toBe("side");
    expect(pick.angleDegrees).toBeCloseTo(0, 9);
  });
  it("treats a coffee table's back as its front", () => {
    const table = PHOTO_ASSET_SETS["oak-frame-table"]!;
    const pick = selectPhotoView(objectAt(-1, Math.PI, "coffee_table"), table);
    expect(pick).toMatchObject({ mirrored: false, exact: true });
  });
  it("never mirrors radial objects", () => {
    const lamp = PHOTO_ASSET_SETS["brass-globe-lamp"]!;
    expect(selectPhotoView(objectAt(2, Math.PI * 0.7, "floor_lamp"), lamp)).toMatchObject({ mirrored: false, exact: true, angleDegrees: 0 });
  });
});

describe("viewFidelity and rotation options", () => {
  it("scores photographed, mirrored, and generated coverage", () => {
    const set = withViews(sofaSet(), ["side"]);
    expect(viewFidelity(facingOf(0), sofaSet())).toBe(1);
    expect(viewFidelity(facingOf(Math.PI / 4), sofaSet())).toBeCloseTo(0.95, 12);
    expect(viewFidelity(facingOf(-Math.PI / 2), sofaSet())).toBe(0);
    expect(viewFidelity(facingOf(-Math.PI / 2), set)).toBeCloseTo(0.8, 12);
    expect(viewFidelity(facingOf(Math.PI / 2), set)).toBeCloseTo(0.76, 12);
  });
  it("offers 0 and ±45° for photographed-only seating", () => {
    const options = rotationOptionsFor({ rotation: [0, 0, 0], type: "sofa", assetId: "hinoki-low-sofa" }, sofaSet());
    expect(options.map((o) => Math.round((o.rotationY * 180) / Math.PI)).sort((a, b) => a - b)).toEqual([-45, 0, 45]);
    expect(options.find((o) => o.rotationY === 0)?.fidelity).toBe(1);
  });
  it("offers every 45° step with the full generated set", () => {
    const full = withViews(sofaSet(), ["side", "back-quarter", "back"]);
    const options = rotationOptionsFor({ rotation: [0, 0, 0], type: "sofa", assetId: "hinoki-low-sofa" }, full);
    expect(options).toHaveLength(8);
  });
  it("offers front-back symmetric steps for coffee tables and keeps a current off-grid rotation", () => {
    const table = PHOTO_ASSET_SETS["oak-frame-table"]!;
    const options = rotationOptionsFor({ rotation: [0, 0.3, 0], type: "coffee_table", assetId: "oak-frame-table" }, table);
    const degrees = options.map((o) => Math.round((o.rotationY * 180) / Math.PI)).sort((a, b) => a - b);
    expect(degrees).toEqual([-135, -45, 0, 17, 45, 135, 180]);
  });
  it("gives radial and unregistered objects only their current rotation at fidelity 1", () => {
    expect(rotationOptionsFor({ rotation: [0, 1, 0], type: "floor_lamp", assetId: "brass-globe-lamp" }, PHOTO_ASSET_SETS["brass-globe-lamp"]!)).toEqual([{ rotationY: 1, fidelity: 1 }]);
    expect(rotationOptionsFor({ rotation: [0, 1, 0], type: "sofa" }, null)).toEqual([{ rotationY: 1, fidelity: 1 }]);
  });
  it("builds options for every demo object by id", () => {
    const options = buildRotationOptions(createDemoScene());
    expect(Object.keys(options).sort()).toEqual(["chair_01", "lamp_01", "plant_01", "rug_01", "sofa_01", "table_01"]);
    expect(options.rug_01).toEqual([{ rotationY: 0, fidelity: 1 }]);
    expect(options.chair_01).toHaveLength(3);
  });
});
```

- [ ] **Step 6: Run to verify failure** — `pnpm vitest run tests/unit/photo-views.test.ts` — Expected: FAIL.

- [ ] **Step 7: Implement `photo-views.generated.json` and `photo-views.ts`**

`photo-views.generated.json`: `{ "version": 1, "views": [] }`.

Implementation notes for `photo-views.ts`:

```ts
import { z } from "zod";
import { DEMO_PRODUCTS } from "../demo/demo-data";
import type { Scene, SceneObject, SceneObjectType } from "../scene/scene-schema";
import { PHOTO_ASSETS, type NormalizedQuad, type PhotoAsset } from "./photo-assets";
import { FRONT_VECTORS, PHOTO_VIEW_NAMES, angleBetweenDegrees, facingOf, type FacingVector, type PhotoViewName } from "./photo-facing";
import manifest from "./photo-views.generated.json";

export const PHOTO_VIEW_SYMMETRY = Object.freeze({ sofa: "none", chair: "none", coffee_table: "front-back", floor_lamp: "radial", plant: "radial", rug: "radial", unknown: "none" } as const satisfies Record<SceneObjectType, PhotoViewSymmetry>);
const COVERAGE_DEGREES = 45;
const ORIGIN_WEIGHT = { photographed: 1, generated: 0.8 } as const;
const MIRROR_WEIGHT = 0.95;
const STEP = Math.PI / 4;

export const GeneratedViewManifestSchema = z.object({
  version: z.literal(1),
  views: z.array(z.object({
    assetId: z.string().min(1), view: z.enum(["side", "back-quarter", "back"]), src: z.string().startsWith("/demo/photo/"),
    intrinsicWidth: z.number().int().positive(), intrinsicHeight: z.number().int().positive(),
    anchorX: z.number().min(0).max(1), anchorY: z.number().min(0).max(1), model: z.string().min(1), generatedAt: z.string().datetime(),
  }).strict()),
}).strict();
```

`buildPhotoAssetSets` parses the manifest with the schema, throws `Error("photo-views manifest: unknown asset <id>")` and `Error("photo-views manifest: duplicate view <id>/<view>")`, and produces views `[frontQuarter, ...generated in PHOTO_VIEW_NAMES order]` without `model`/`generatedAt`. `PHOTO_ASSET_SETS = buildPhotoAssetSets(PHOTO_ASSETS, PHOTO_ASSET_TYPES, manifest)`.

`selectPhotoView`: candidates per spec 6 (mirrored candidates only when symmetry is not radial; for `front-back` compare against both `facing` and `-facing`, keep the smaller angle); pick by smallest angle; tie (`|Δangle| < 1e-7` degrees) toward the room centre (`position[0] < 0` → prefer `frontVector.x > 0`, else prefer `frontVector.x <= 0`), then photographed, then not mirrored, then source order; `exact = angleDegrees <= 45`; `anchorX` is `1 - anchorX` when mirrored.

`viewFidelity`: radial → 1; otherwise the max over the same candidate list of `ORIGIN_WEIGHT[origin] * (mirrored ? MIRROR_WEIGHT : 1)` for candidates within `COVERAGE_DEGREES`; 0 when none.

`rotationOptionsFor`: `set === null` or radial → `[{ rotationY: rotation[1], fidelity: 1 }]`; otherwise for `k = -3..4` compute `yaw = k * STEP`, `fidelity = viewFidelity(facingOf(yaw), set)`, keep `fidelity > 0`; then ensure the current rotation is present (compare with `1e-9`), adding `{ rotationY: rotation[1], fidelity: max(viewFidelity(current), 0) }`; when its fidelity is 0 still include it with fidelity `0.01` so the incumbent layout stays scoreable but never preferred. Order by rotationY ascending.

`buildRotationOptions(scene)`: `Object.fromEntries(scene.objects.map((o) => [o.id, rotationOptionsFor(o, getPhotoAssetSet(o))]))`.

- [ ] **Step 8: Run both tests, then typecheck**

Run: `pnpm vitest run tests/unit/photo-facing.test.ts tests/unit/photo-views.test.ts && pnpm typecheck` — Expected: PASS, no errors. If the JSON import needs a type, add `declare module "*.generated.json"` in `src/types/json.d.ts` only if `tsc` complains (resolveJsonModule is already on).

- [ ] **Step 9: Commit**

```bash
git add src/features/photo/photo-facing.ts src/features/photo/photo-views.ts src/features/photo/photo-views.generated.json tests/unit/photo-facing.test.ts tests/unit/photo-views.test.ts
git commit -m "feat(photo): add facing vectors, view registry, selection, and rotation options"
```

---

### Task 2: Compositor renders truthful views with mirroring; inspector shows facing

**Files:**
- Modify: `src/features/photo/photo-object-layer.tsx`
- Modify: `src/features/photo/photo-asset-image.tsx` (accept `mirrored`, `view`, `approximate` data attributes)
- Modify: `src/features/photo/room-photo-stage.tsx` (use `getPhotoAssetSet` + `selectPhotoView`; pass the selected view's anchors/intrinsics to projection where `getPhotoAsset` was used)
- Modify: `src/features/demo/demo-workspace.module.css` (remove the `--photo-rotation` counter-rotation rule at the lock badge; add `.photoMirrored img { transform: scaleX(-1); }`)
- Modify: `src/features/demo/context-panel.tsx` (Facing row)
- Test: `tests/unit/room-photo-stage.test.tsx`, `tests/unit/demo-workspace.test.tsx` (if the inspector is covered there), `tests/e2e/photo-compositor.spec.ts`

**Interfaces:**
- Consumes: `getPhotoAssetSet`, `selectPhotoView`, `facingOf`, `roundFacing` from Task 1.
- Produces: frame attributes `data-photo-view`, `data-photo-mirrored`, `data-photo-approximate` on `[data-testid="photo-object-frame-<id>"]`; inspector row `<dt>Facing</dt>`.

- [ ] **Step 1: Write failing component tests** (append to `tests/unit/room-photo-stage.test.tsx`, reusing its existing render helpers)

```ts
it("renders the chair on the right with the mirrored front-quarter view and no CSS rotation", () => {
  // seed chair_01 sits at x > 0 with rotation 0
  const frame = screen.getByTestId("photo-object-frame-chair_01");
  expect(frame.dataset.photoView).toBe("front-quarter");
  expect(frame.dataset.photoMirrored).toBe("true");
  expect(frame.dataset.photoApproximate).toBe("false");
  expect(frame.style.transform).not.toContain("rotate(");
  const image = within(frame).getByRole("button").querySelector("img")!;
  expect(getComputedStyle(image).transform || image.style.transform).toContain("scaleX(-1)");
});

it("keeps the sofa on the left un-mirrored", () => {
  const frame = screen.getByTestId("photo-object-frame-sofa_01");
  expect(frame.dataset.photoMirrored).toBe("false");
});

it("marks a 90° keyboard rotation approximate when no side view exists", async () => {
  // select sofa_01, switch to rotate mode, press Shift+ArrowRight six times (6 × 15° = 90°)
  ...existing helpers...
  expect(screen.getByTestId("photo-object-frame-sofa_01").dataset.photoApproximate).toBe("true");
  expect(screen.getByText(/approximate/i)).toBeInTheDocument();
});
```

Also update the two existing assertions that expect `rotate(0deg)` in transforms (lines near 196 and 880) to the new transform without `rotate(`.

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run tests/unit/room-photo-stage.test.tsx` — Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

`room-photo-stage.tsx`: for every non-rug object compute `const set = getPhotoAssetSet(object); const selected = set ? selectPhotoView(object, set) : null;` and pass to projection the `PhotoAsset`-shaped value `{ id, src, intrinsicWidth, intrinsicHeight, anchorX: selected.anchorX, anchorY: selected.view.anchorY }` wherever `getPhotoAsset(object)` was used, so anchors, shadows, and hit areas agree. Pass `selected` to `PhotoObjectLayer`.

`photo-object-layer.tsx`: new prop `selected: SelectedPhotoView | null`; delete the `rotation` string, `--photo-rotation`, and the `rotate(${rotation})` part of `frameStyle.transform` (keep the translate); add `data-photo-view`, `data-photo-mirrored`, `data-photo-approximate` on the frame; add class `styles.photoMirrored` to the button when mirrored. `PhotoAssetImage` renders `style={{ transform: mirrored ? "scaleX(-1)" : undefined }}` on the `<img>`.

CSS: delete the rule `transform: rotate(calc(var(--photo-rotation) * -1));` (line ~557) and add `.photoMirrored img { transform: scaleX(-1); }`.

`context-panel.tsx`: add after Rotation:

```tsx
<dt>Facing</dt>
<dd>{formatFacing(selectedObject)}</dd>
```

with `formatFacing` producing `x 0.00 · z 1.00 · front-quarter` plus ` · mirrored` and ` · approximate` from `selectPhotoView` when a set exists, else `x 0.00 · z 1.00`.

- [ ] **Step 4: Update E2E** in `tests/e2e/photo-compositor.spec.ts`: replace the `rotation: style.getPropertyValue("--photo-rotation")` read with `view: element.getAttribute("data-photo-view"), mirrored: element.getAttribute("data-photo-mirrored")`, and add, in the arrangement journey after "Arrange naturally", `await expect(page.getByTestId("photo-object-frame-chair_01")).toHaveAttribute("data-photo-mirrored", "true")` and an assertion that no `[data-testid^="photo-object-frame-"]` has a `style.transform` containing `rotate(`. (The chair expectation may need to wait for Task 4; if the current solver leaves the chair left of centre, assert `data-photo-mirrored` equals the sign rule for its current `x` instead, and Task 4 tightens it.)

- [ ] **Step 5: Run gates**

Run: `pnpm vitest run tests/unit/room-photo-stage.test.tsx tests/unit/demo-workspace.test.tsx && pnpm test && pnpm typecheck && pnpm lint`, then start `pnpm exec next dev --hostname 127.0.0.1 --port 3100` in the background and run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test tests/e2e/photo-compositor.spec.ts`. Expected: all pass. Stop the server you started.

- [ ] **Step 6: Commit** — `git commit -am "feat(photo): render truthful views with mirroring instead of CSS rotation"` (add new files explicitly if any).

---

### Task 3: WebMCP facing output and `move_object` facing input

**Files:**
- Modify: `src/webmcp/tool-contracts.ts` (facing schema, `ToolSceneObjectSchema`, `ToolSceneSchema`, `MOVE_OBJECT_JSON_SCHEMA.properties.facing`)
- Modify: `src/webmcp/tool-handlers.ts` (extend outputs; convert facing → rotationYDegrees; mutual exclusion)
- Modify: `src/webmcp/core-tool-manifest.ts` (descriptions mention facing)
- Modify: `tests/evals/webmcp-journeys.json` (add `face-the-sofa`)
- Test: `tests/unit/webmcp-tools.test.ts`, `tests/unit/tool-contracts.test.ts`, `tests/unit/core-tool-manifest.test.ts` (only if it pins literal descriptions), `tests/e2e/webmcp-core.spec.ts`

**Interfaces:**
- Consumes: `facingOf`, `roundFacing`, `normalizeFacing`, `rotationYOf` (Task 1).
- Produces: `get_scene` data = Scene whose objects carry `facing: { x, z }`; `get_selection` data = object with `facing`; `move_object` accepts `facing`.

- [ ] **Step 1: Write failing tests** (in `tests/unit/webmcp-tools.test.ts`, using its existing `createContext`/tool helpers)

```ts
describe("facing", () => {
  it("returns a derived unit facing on every get_scene object and on get_selection", async () => {
    const scene = await run("get_scene", {});
    for (const object of scene.data.objects) {
      expect(object.facing).toEqual(roundFacing(facingOf(object.rotation[1])));
    }
    const selection = await run("get_selection", {});
    expect(selection.data.facing).toEqual({ x: 0, z: 1 });
  });
  it("moves with a facing vector", async () => {
    const result = await run("move_object", { objectId: "chair_01", position: { x: 1, z: 0.5 }, facing: { x: -2, z: 0 }, expectedRevision, expectedStateVersion });
    expect(result.ok).toBe(true);
    const chair = sceneObject("chair_01");
    expect(chair.rotation[1]).toBeCloseTo(Math.PI / 2, 9); // facing -x  => yaw +90°
  });
  it("rejects a zero-length facing and facing combined with rotationYDegrees", async () => {
    const zero = await run("move_object", { objectId: "chair_01", position: { x: 1, z: 0.5 }, facing: { x: 0, z: 0 }, expectedRevision, expectedStateVersion });
    expect(zero).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(zero.error.issues.map((i) => i.path)).toContain("facing");
    const both = await run("move_object", { objectId: "chair_01", position: { x: 1, z: 0.5 }, facing: { x: 0, z: 1 }, rotationYDegrees: 10, expectedRevision, expectedStateVersion });
    expect(both).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(revisionUnchanged()).toBe(true);
  });
});
```

Adapt helper names to the file's existing conventions; the assertions are the contract. Check the sign: `facing {x:-1,z:0}` → `rotationYOf` = `atan2(1, 0)` = `+π/2`.

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run tests/unit/webmcp-tools.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`tool-contracts.ts`:

```ts
const facing = z.object({ x: z.number().finite(), z: z.number().finite() }).strict().optional();
export const moveObjectInputSchema = z.object({ objectId, position, rotationYDegrees, facing, expectedRevision, expectedStateVersion }).strict()
  .superRefine((input, ctx) => {
    if (input.facing && input.rotationYDegrees !== undefined) ctx.addIssue({ code: "custom", path: ["facing"], message: "Provide either facing or rotationYDegrees, not both" });
    if (input.facing && normalizeFacing(input.facing) === null) ctx.addIssue({ code: "custom", path: ["facing"], message: "facing must be a non-zero finite XZ vector" });
  });
export const FacingSchema = z.object({ x: z.number(), z: z.number() }).strict();
export const ToolSceneObjectSchema = SceneObjectSchema.extend({ facing: FacingSchema });
export const ToolSceneSchema = SceneSchema.extend({ objects: z.array(ToolSceneObjectSchema) });
```

Keep the existing field order and `.strict()`. JSON schema: `facing: { type: "object", properties: { x: { type: "number" }, z: { type: "number" } }, required: ["x", "z"], additionalProperties: false }` with a `description` "Unit XZ direction the object's front points; {x:0,z:1} faces the camera side (front wall), {x:0,z:-1} faces the back wall. Mutually exclusive with rotationYDegrees."

`tool-handlers.ts`: helper `withFacing(object) => ({ ...object, facing: roundFacing(facingOf(object.rotation[1])) })`; `get_scene` returns `{ ...snapshot.scene, objects: snapshot.scene.objects.map(withFacing) }`; `get_selection` returns `withFacing(SceneObjectSchema.parse(selection))`; `move_object` computes `rotationYDegrees = parsed.data.facing ? (rotationYOf(normalizeFacing(parsed.data.facing)!) * 180) / Math.PI : parsed.data.rotationYDegrees` and passes it to the existing command.

`core-tool-manifest.ts` descriptions: get_scene "Return the current validated Scene; each object includes a derived unit facing vector {x, z} ({x:0,z:1} faces the camera side)." get_selection similarly; move_object "Move an explicit or selected Scene object; orient it with rotationYDegrees or a facing vector {x, z}." Update any test that pins these literal strings or a manifest hash.

Evals: add

```json
{
  "id": "face-the-sofa",
  "prompt": "Turn the chair to face the sofa",
  "expectedTools": ["get_scene", "move_object"],
  "assertions": [
    "move_object is called with facing pointing from the chair centre toward the sofa centre",
    "The returned scene's chair facing matches the requested direction within 0.01",
    "rotationYDegrees is not sent together with facing"
  ]
}
```

E2E `webmcp-core.spec.ts`: in the existing get_scene assertion add `expect(scene.objects[0].facing).toEqual({ x: 0, z: 1 })` for the seed sofa and one `move_object` call with `facing` verifying the returned rotation.

- [ ] **Step 4: Run gates** — `pnpm vitest run tests/unit/webmcp-tools.test.ts tests/unit/tool-contracts.test.ts tests/unit/core-tool-manifest.test.ts && pnpm test && pnpm typecheck && pnpm lint`; E2E `webmcp-core.spec.ts` against your port-3100 server. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(webmcp): expose facing vectors and accept facing on move_object"`.

---

### Task 4: Solver rotation options, fidelity and composition scoring, chair flanking, lamp adjacency

**Files:**
- Modify: `src/features/placement/placement-types.ts` (add `RotationOption`, `PlacementOptions`)
- Modify: `src/features/placement/placement-profile.ts` (weights; bump `PLACEMENT_PROFILE_VERSION` to 2)
- Modify: `src/features/placement/natural-placement.ts`
- Modify: `src/features/scene/natural-placement-command.ts` (re-validate rotations against options)
- Modify: `src/features/scene/scene-store.ts` (`rotationOptions?: (scene: Scene) => PlacementOptions["rotationOptions"]` in `SceneStoreOptions`; the proposer wrapper passes `{ rotationOptions: options.rotationOptions?.(scene) }`; `validateAndApplyPlacement(scene, proposal, rotationOptions)`)
- Modify: `src/features/scene/scene-context.tsx` (default store gets `rotationOptions: buildRotationOptions`)
- Test: `tests/unit/natural-placement.test.ts`, `tests/unit/scene-store.test.ts`, `tests/e2e/photo-compositor.spec.ts`

**Interfaces:**
- Consumes: `RotationOption`, `buildRotationOptions` (Task 1). `placement-types.ts` re-exports `RotationOption` from `photo-facing`? No: define `RotationOption` in `placement-types.ts` and have `photo-views.ts` import it from there (fix the Task 1 import direction: placement must not depend on photo). Move the interface in this task and update `photo-views.ts` to `import type { RotationOption } from "../placement/placement-types"`.
- Produces: `proposeNaturalPlacement(scene, options?)`, `validateAndApplyPlacement(scene, proposal, rotationOptions?)`.

- [ ] **Step 1: Write failing solver tests** (extend `tests/unit/natural-placement.test.ts` with its existing scene builders)

```ts
describe("rotation options", () => {
  it("preserves every rotation when no options are given (legacy behaviour)", () => { /* existing test 'preserves the exact Y rotation' stays, renamed */ });
  it("never proposes a rotation outside an object's options", () => {
    const scene = createDemoScene();
    const options = { rotationOptions: { chair_01: [{ rotationY: 0, fidelity: 1 }, { rotationY: -Math.PI / 4, fidelity: 0.95 }, { rotationY: Math.PI / 4, fidelity: 0.95 }] } };
    const result = proposeNaturalPlacement(poorScene(scene), options);
    expect(result.kind).toBe("changed");
    const chair = placements(result).find((p) => p.objectId === "chair_01")!;
    expect([0, -Math.PI / 4, Math.PI / 4].some((r) => Math.abs(r - chair.rotationY) < 1e-9)).toBe(true);
  });
  it("flanks the sofa with the chair turned 45° toward the table for the seed demo", () => {
    const result = proposeNaturalPlacement(poorScene(createDemoScene()), { rotationOptions: buildRotationOptions(createDemoScene()) });
    const layout = arranged(result);
    const sofa = layout.sofa_01, chair = layout.chair_01, table = layout.table_01, lamp = layout.lamp_01, plant = layout.plant_01;
    expect(sofa.rotation[1]).toBe(0);
    expect(sofa.position[2]).toBeLessThan(-1.5);                       // back wall
    expect(Math.abs(chair.rotation[1])).toBeCloseTo(Math.PI / 4, 9);   // 45° toward the table
    expect(Math.abs(chair.position[0] - sofa.position[0])).toBeGreaterThan(1.2); // beside a sofa end
    expect(chair.position[2]).toBeLessThan(table.position[2] + 0.3);   // not in front of the table
    expect(Math.abs(lamp.position[0] - sofa.position[0])).toBeGreaterThan(1.0); // beside the other sofa end
    expect(lamp.position[2]).toBeLessThan(-1.0);
    expect(Math.min(plant.position[2] + scene.room.depth / 2, scene.room.depth / 2 - plant.position[2])).toBeLessThan(0.7); // a corner row
    expect(collidingObjectIds(layout)).toEqual([]);
  });
  it("is deterministic with options", () => { expect(JSON.stringify(run())).toBe(JSON.stringify(run())); });
  it("keeps the seed layout under the candidate and beam caps", () => { /* diagnostics.evaluatedLayouts stays bounded; reuse the existing performance-style assertion */ });
});
```

Extend the existing weight test (if any) to the new table and add `expect(Object.values(PLACEMENT_SCORE_WEIGHTS).reduce((a, b) => a + b)).toBe(10_000)`.

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run tests/unit/natural-placement.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the solver changes**

1. `placement-types.ts`: `export interface RotationOption { rotationY: number; fidelity: number }`, `export interface PlacementOptions { rotationOptions?: Readonly<Record<string, readonly RotationOption[]>> }`.
2. `placement-profile.ts`: weights per Global Constraints; `PLACEMENT_PROFILE_VERSION = 2`.
3. `natural-placement.ts`:
   - Thread `options` through `proposeNaturalPlacement → resolvePlacementSearch → searchLayouts → candidatesFor`. Helper `optionsFor(object): readonly RotationOption[]` returns the table entry or `[{ rotationY: object.rotation[1], fidelity: 1 }]`; rugs always use their existing rotation logic.
   - `sofaCandidates(scene, object, options)`: for each option, the existing wall sweeps with `usableSofaWalls(option.rotationY)`; incumbent first.
   - `chairCandidates(scene, object, objects, options)`: incumbent; then the three families from spec 8.2, each family only when its rotation (normalised to `(-π, π]`) matches an option within `1e-9`: flank (`gap ∈ {0.15, 0.3}`, forward `{0.2, 0.5}`, rotation `sofaYaw ∓ π/4` — left end (negative lateral) turns right = `sofaYaw - π/4`; right end turns left = `sofaYaw + π/4`), across (offsets `{0, ±0.3}`, rotation `sofaYaw + π`), side-of-table (`table.halfWidth + chair.halfDepth + {0.3, 0.5}` on either lateral side, rotation `sofaYaw ± π/2` facing the table: the +lateral side uses `sofaYaw + π/2`... verify with `facingOf` that dot(facing, tableCentre - chairCentre) > 0 and flip if not).
   - Accessory candidates: keep the ring; add sofa-end lamp candidates (lateral gap `{0.1, 0.25}` beyond each sofa end, `z` aligned with the sofa centre) appended before the ring flattening, respecting the cap.
   - Scoring: `chairRelationScore` rewritten per spec 8.3 (facing 5 : distance 3 : spread 2); new `viewFidelityScore(objects, options)` and `compositionScore(scene, objects)` per spec 8.3; `layoutTerms` gains `viewFidelity` and `composition`; `weightedScore` uses the new weights. Quantise from millimetres like the existing terms.
   - Return `rotationY` as the option value exactly (no float drift): store option rotations on candidates rather than recomputing.
4. `natural-placement-command.ts`: `validateAndApplyPlacement(scene, proposal, rotationOptions?)` rejects as `invalid-input` any non-rug placement whose `rotationY` is not within `1e-9` of an option when `rotationOptions` has an entry for that object.
5. `scene-store.ts` + `scene-context.tsx` wiring as listed in Files.

Read spec 8 fully before coding; every formula is there.

- [ ] **Step 4: Run gates** — `pnpm vitest run tests/unit/natural-placement.test.ts tests/unit/scene-store.test.ts tests/unit/placement-geometry.test.ts && pnpm test && pnpm typecheck && pnpm lint`. Then E2E `photo-compositor.spec.ts` on port 3100 including the p95 gate: run it once as `pnpm run build:next && pnpm exec next start --hostname 127.0.0.1 --port 3100` for the performance test (the gate is skipped only when `CI` is set). Tighten the Task 2 E2E chair assertion to `data-photo-mirrored="true"` if it was deferred. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(placement): turn seating toward truthful views and compose like a staged photo"`.

---

### Task 5: Offline gpt-image-1 view pipeline, env, docs

**Files:**
- Create: `scripts/openinterior-assets/view-jobs.ts` (pure core)
- Create: `scripts/openinterior-assets/generate-views.ts` (shell)
- Create: `docs/asset-views.md`
- Modify: `package.json` (`"assets:views": "tsx scripts/openinterior-assets/generate-views.ts"`; `pnpm add -D sharp`)
- Modify: `.env.example` (replace the `TRIPO_*`/`ROOM_AI_*` block per spec 9.4)
- Modify: `README.md` (section "Facing and views"), `AGENTS.md` (rule per spec 12)
- Modify: `tests/e2e/photo-assets.spec.ts` (audit generated views from the manifest too)
- Test: `tests/unit/view-jobs.test.ts`

**Interfaces:**
- Consumes: `PHOTO_ASSET_SETS`, `PHOTO_VIEW_SYMMETRY`, `GeneratedViewManifestSchema`, `PHOTO_VIEW_NAMES` (Task 1).
- Produces:

```ts
// view-jobs.ts
export interface ViewJob { assetId: string; view: "side" | "back-quarter" | "back"; referenceSrc: string; outputSrc: string; category: SceneObjectType; landscape: boolean }
export interface CliOptions { dryRun: boolean; force: boolean; products: string[]; views: ViewJob["view"][] }
export function parseArgs(argv: readonly string[]): CliOptions;
export function planJobs(sets: Record<string, PhotoAssetSet>, manifest: GeneratedViewManifest, options: CliOptions): ViewJob[];
export function buildPrompt(job: ViewJob): string;
export function multipartFields(job: ViewJob, env: { model: string; quality: "low" | "medium" | "high" }): Array<[string, string]>; // excludes the file part
export function measureAnchor(rgba: Uint8Array, width: number, height: number): { anchorX: number; anchorY: number } | null;
export function mergeManifest(manifest: GeneratedViewManifest, entries: GeneratedViewEntry[]): GeneratedViewManifest;
export function outputSrcFor(assetId: string, view: ViewJob["view"], referenceSrc: string): string; // "<dir>/<assetId>--<view>.webp"
```

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/view-jobs.test.ts
import { describe, expect, it, vi } from "vitest";
import { PHOTO_ASSET_SETS } from "../../src/features/photo/photo-views";
import { buildPrompt, measureAnchor, mergeManifest, multipartFields, outputSrcFor, parseArgs, planJobs } from "../../scripts/openinterior-assets/view-jobs";

describe("view jobs", () => {
  it("plans 28 jobs for the demo catalog with an empty manifest", () => {
    const jobs = planJobs(PHOTO_ASSET_SETS, { version: 1, views: [] }, parseArgs([]));
    expect(jobs).toHaveLength(28);
    expect(jobs.filter((j) => j.category === "coffee_table").every((j) => j.view === "side")).toBe(true);
    expect(jobs.some((j) => j.category === "floor_lamp" || j.category === "plant" || j.category === "rug")).toBe(false);
  });
  it("skips existing entries unless --force and filters by product and view", () => {
    const entry = { assetId: "hinoki-low-sofa", view: "side", src: "/demo/photo/products/hinoki-low-sofa--side.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5, anchorY: 0.9, model: "gpt-image-1", generatedAt: "2026-09-03T00:00:00.000Z" } as const;
    expect(planJobs(PHOTO_ASSET_SETS, { version: 1, views: [entry] }, parseArgs([]))).toHaveLength(27);
    expect(planJobs(PHOTO_ASSET_SETS, { version: 1, views: [entry] }, parseArgs(["--force"]))).toHaveLength(28);
    expect(planJobs(PHOTO_ASSET_SETS, { version: 1, views: [] }, parseArgs(["--product", "hinoki-low-sofa", "--view", "back"]))).toEqual([expect.objectContaining({ assetId: "hinoki-low-sofa", view: "back" })]);
  });
  it("names outputs beside the reference", () => {
    expect(outputSrcFor("seed-dated-sofa", "back", "/demo/photo/seed/seed-dated-sofa.webp")).toBe("/demo/photo/seed/seed-dated-sofa--back.webp");
  });
  it("builds the prompt and multipart fields from the spec", () => {
    const job = planJobs(PHOTO_ASSET_SETS, { version: 1, views: [] }, parseArgs(["--product", "ash-lounge-chair", "--view", "side"]))[0]!;
    const prompt = buildPrompt(job);
    expect(prompt).toContain("exact same armchair");
    expect(prompt).toContain("pure 90-degree profile");
    expect(prompt).toContain("fully transparent background");
    expect(Object.fromEntries(multipartFields(job, { model: "gpt-image-1", quality: "high" }))).toEqual({
      model: "gpt-image-1", prompt, background: "transparent", output_format: "webp", output_compression: "100", size: "1536x1024", quality: "high", input_fidelity: "high", n: "1",
    });
  });
  it("measures the anchor from alpha ≥ 16", () => {
    const width = 10, height = 10, rgba = new Uint8Array(width * height * 4);
    const set = (x: number, y: number, a: number) => { rgba[(y * width + x) * 4 + 3] = a; };
    set(2, 3, 255); set(6, 8, 200); set(9, 9, 8); // faint pixel ignored
    expect(measureAnchor(rgba, width, height)).toEqual({ anchorX: 0.45, anchorY: 0.9 }); // (2+6+1)/2/10, (8+1)/10
    expect(measureAnchor(new Uint8Array(400), 10, 10)).toBeNull();
  });
  it("merges by (assetId, view) and sorts", () => {
    const a = { assetId: "b", view: "side", src: "/demo/photo/products/b--side.webp", intrinsicWidth: 1, intrinsicHeight: 1, anchorX: 0, anchorY: 1, model: "m", generatedAt: "2026-09-03T00:00:00.000Z" } as const;
    const merged = mergeManifest({ version: 1, views: [{ ...a, anchorX: 0.1 }] }, [a, { ...a, assetId: "a", view: "back" }]);
    expect(merged.views.map((v) => `${v.assetId}/${v.view}/${v.anchorX}`)).toEqual(["a/back/0", "b/side/0"]);
  });
});
```

And a shell test with a fake fetch (same file): `runGenerateViews({ env: {}, fetch: vi.fn(), argv: ["--dry-run"] })` resolves with `exitCode: 0` and `fetch` not called; with no key and no `--dry-run` resolves `exitCode: 2`, `fetch` not called. Export `runGenerateViews(deps)` from `generate-views.ts` (guard the CLI entry with `if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1])))` or a `main` module check) so the shell is testable without sharp being exercised: inject `decode`/`encode` functions and pass no-op fakes in tests.

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run tests/unit/view-jobs.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`pnpm add -D sharp` (commit the lockfile change). `generate-views.ts`: `process.loadEnvFile(".env.local")` inside try/catch when the file exists; `runGenerateViews({ argv, env, fetch, readFile, writeFile, decode, encode, now })`; POST to `https://api.openai.com/v1/images/edits` with `Authorization: Bearer ${key}` and a `FormData` carrying the fields plus `image` as a `Blob` (`type: "image/webp"`) named after the reference file; retry 429/5xx three times (2s, 4s, 8s); decode `data[0].b64_json` with `sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })` for the anchor and `sharp(buffer).webp({ lossless: true })` for the file; write the manifest after each job. Log progress lines only (`[views] hinoki-low-sofa/side ok (anchor 0.50, 0.87)`); never print env values.

Docs per spec 12; `.env.example` per spec 9.4; README section explains facing/views, the manifest, `pnpm assets:views --dry-run`, the cost order of magnitude (28 images), and that the app never calls the model.

`tests/e2e/photo-assets.spec.ts`: extend the audited list with every manifest view (`intrinsicWidth/Height`, alpha 0..>0) so the count becomes `26 + manifest.views.length`.

- [ ] **Step 4: Run gates** — `pnpm vitest run tests/unit/view-jobs.test.ts && pnpm assets:views --dry-run && pnpm test && pnpm typecheck && pnpm lint && pnpm build:next`. Expected: dry-run prints 28 planned jobs and exits 0 without network; all gates pass.

- [ ] **Step 5: Commit** — `git add -A scripts/openinterior-assets docs/asset-views.md tests/unit/view-jobs.test.ts package.json pnpm-lock.yaml .env.example README.md AGENTS.md tests/e2e/photo-assets.spec.ts && git commit -m "feat(assets): add the offline gpt-image-1 view generation pipeline"`.

---

### Task 6: Visual acceptance and handoff docs

**Files:**
- Create: `output/playwright/facing-views/seed-1440x900.png`, `arranged-1440x900.png` (git-ignored output, referenced by path)
- Modify: `docs/NEXT_SESSION.md` (new section "Facing vectors and views": what changed, how to run the pipeline, expected arranged layout coordinates from Task 4's test)

- [ ] **Step 1: Capture** with a Playwright script against `pnpm run build:next && pnpm exec next start --hostname 127.0.0.1 --port 3100`: `/demo` seed, then click "Arrange naturally", screenshot both at 1440x900.
- [ ] **Step 2: Inspect** both images (Read tool) and confirm: no tilted cutouts, chair mirrored and flanking, lamp beside the sofa, plant in a back corner, nothing in the foreground. Fix the solver or view selection if not; re-run Task 4 gates.
- [ ] **Step 3: Write** the `NEXT_SESSION.md` section, run `pnpm test && pnpm typecheck && pnpm lint`, commit `docs: record facing vectors and view pipeline handoff`.
