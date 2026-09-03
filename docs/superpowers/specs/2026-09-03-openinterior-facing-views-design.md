# OpenInterior Facing Vectors and Multi-View Cutouts Design

Date: 2026-09-03. Status: approved direction (model: OpenAI gpt-image-1; execution
method chosen by exploration, see section 3).

## 1. Outcome

Every furniture cutout carries the direction its front points in the photo
(`frontVector`). Every Scene object exposes the direction its front points in the
room (`facing`, derived from its Y rotation). The photo compositor shows the
cutout whose front vector best matches the object's facing, mirroring left/right
twins for free, instead of tilting a single picture with CSS `rotate`. Views the
catalog lacks are produced once, offline, by an image model from the existing
cutout, checked into `public/demo`, and registered in a generated manifest. The
placement solver may now turn seating objects, but only toward directions that a
registered view can show truthfully, and it composes the room the way a staged
product photo is composed: seating faces the camera side, chairs flank or face
the group, lamps stand beside the sofa, plants take back corners, nothing crowds
the foreground.

The result must make the demo room read as a real room: no chair turning its
back on the group, no lamp in the middle of the floor, no cutout tilted like a
photograph pinned at an angle.

## 2. Governing Invariants

Everything below stays true:

- Validated `Scene` JSON is the only persisted room/object model. `rotation[1]`
  stays the single source of truth for orientation; `facing` is derived and is
  never stored on the Scene.
- The app has no server inference route, no API key, and no runtime image
  generation. `ASSET_PROVIDER=cached` remains the only runtime mode. Generation
  is a developer-run script whose key lives only in `.env.local`.
- The WebMCP surface stays exactly the Core 6. No image, render, or generation
  tool is added. `move_object` stays a one-object command.
- The placement solver stays pure, deterministic, viewport-agnostic, and inside
  the 16ms p95 gate on the reference machine. It never proposes an orientation
  that has no truthful registered view.
- Rugs keep the existing floor homography and floor-plane rotation.
- Commerce stays token-free and server-free as in the commerce spec.
- Humans keep free rotation. The compositor renders the nearest truthful view
  and discloses when it is only approximate.

## 3. Execution Method (exploration result)

Three ways to obtain the missing views were weighed against the project's
principles (no backend, no token in the app, reproducible cached demo,
open-source shops can adopt it):

1. **Offline pipeline, checked-in output** (selected). A `tsx` script reads the
   photographed cutout, asks `gpt-image-1` for the missing view with a
   transparent background, measures the floor anchor, writes the WebP beside the
   original, and updates a generated manifest. Runtime stays static. A shop runs
   it once over its catalog. Cost is bounded and visible; results are reviewed
   like any other asset.
2. Runtime generation with a bring-your-own key in the browser. Rejected: puts a
   secret in the page, non-deterministic demo, seconds of latency per turn.
3. Handing images back through the connected AI app. Rejected: WebMCP tool
   inputs are JSON, the Core 6 contract forbids a new image tool, and a 64 KiB
   relay body cannot carry a cutout.

The selected method also degrades honestly: with no generated views the demo
still works, because the front-quarter cutout and its mirror cover every facing
within 80° of the camera, and the solver simply never turns an object further.

## 4. Coordinates, Facing, and Front Vectors

### 4.1 Room frame

Unchanged: `x` grows toward the viewer's right, `z` grows toward the camera
(front wall), `y` is up. An object's forward axis is
`forward(yaw) = { x: -sin(yaw), z: cos(yaw) }`, so `yaw = 0` faces the camera.

### 4.2 Object facing (derived)

```ts
export interface FacingVector { x: number; z: number } // unit length, room XZ
export function facingOf(rotationY: number): FacingVector;      // { -sin, cos }
export function rotationYOf(facing: FacingVector): number;      // atan2(-x, z), radians
export function normalizeFacing(v: { x: number; z: number }): FacingVector | null; // null when |v| < 1e-6 or non-finite
```

`rotationYOf(facingOf(r))` equals `r` normalised to `(-π, π]`.

### 4.3 Image front vector (stored parameter)

Each cutout image records `frontVector`, the direction the furniture's front
points in the image, in the same frame the compositor uses for the photo: the
camera looks along `-z`, the viewer's right is `+x`. The canonical views and
their stored vectors are:

| view            | turn from camera | frontVector (x, z)  |
|-----------------|------------------|---------------------|
| `front-quarter` | 35° to the right | `(0.5736, 0.8192)`  |
| `side`          | 90° to the right | `(1, 0)`            |
| `back-quarter`  | 145° to the right| `(0.5736, -0.8192)` |
| `back`          | 180°             | `(0, -1)`           |

All 24 existing cutouts are photographed `front-quarter` views (their front is
turned to the viewer's right, showing the viewer-left end). A mirrored image has
`frontVector` `(-x, z)`. The vector is the parameter; the view name is derived
by nearest canonical vector and is used only for file names and prompts.

### 4.4 Symmetry

`PHOTO_VIEW_SYMMETRY: Record<SceneObjectType, "none" | "front-back" | "radial">`:
sofa `none`, chair `none`, coffee_table `front-back`, floor_lamp `radial`,
plant `radial`, rug `radial` (rugs never use views), unknown `none`.
`front-back` means a facing `f` and `-f` are shown by the same image;
`radial` means one image serves every facing.

## 5. View Registry

### 5.1 Types

```ts
export type PhotoViewName = "front-quarter" | "side" | "back-quarter" | "back";
export type PhotoViewOrigin = "photographed" | "generated";

export interface PhotoAssetView {
  view: PhotoViewName;
  frontVector: FacingVector;
  src: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  anchorX: number;
  anchorY: number;
  origin: PhotoViewOrigin;
}

export interface PhotoAssetSet {
  id: string;                 // assetId
  type: SceneObjectType;
  symmetry: "none" | "front-back" | "radial";
  views: readonly PhotoAssetView[]; // at least the photographed front-quarter
  floorQuad?: NormalizedQuad; // rugs only, unchanged
}
```

`PHOTO_ASSETS` (24 photographed base assets, the existing `PhotoAsset` shape)
stays as is so the asset inventory tests keep their meaning. A new
`PHOTO_ASSET_SETS: Record<string, PhotoAssetSet>` is built from `PHOTO_ASSETS`
plus `src/features/photo/photo-views.generated.ts`, the manifest the pipeline
writes. `getPhotoAssetSet(object)` replaces `getPhotoAsset` in the compositor;
`getPhotoAsset` remains for existing callers and returns the front-quarter view.

### 5.2 Generated manifest

`src/features/photo/photo-views.generated.ts` is checked in and exports one
constant, `GENERATED_VIEW_MANIFEST: GeneratedViewManifest`, as a plain object
literal with this shape (empty array until the pipeline runs). It is a TypeScript
module rather than JSON so every loader in the project (Next, Vitest, Playwright's
ESM runner, `tsx`) imports it without import attributes:

```ts
export const GENERATED_VIEW_MANIFEST: GeneratedViewManifest = {
  version: 1,
  views: [
    {
      "assetId": "hinoki-low-sofa",
      "view": "side",
      "src": "/demo/photo/products/hinoki-low-sofa--side.webp",
      "intrinsicWidth": 1536,
      "intrinsicHeight": 1024,
      "anchorX": 0.5012,
      "anchorY": 0.8701,
      "model": "gpt-image-1",
      "generatedAt": "2026-09-03T13:00:00.000Z"
    }
  ]
};
```

Loading validates the manifest with Zod (`strict`), rejects a view whose
`assetId` is not a registered base asset, rejects duplicate `(assetId, view)`
pairs, and rejects `view: "front-quarter"` (that view is always photographed).
`model` and `generatedAt` are provenance only and never reach the compositor.

## 6. View Selection (compositor)

```ts
export interface SelectedPhotoView {
  view: PhotoAssetView;
  mirrored: boolean;
  frontVector: FacingVector;   // after mirroring
  angleDegrees: number;        // angle between object facing and frontVector, 0..180
  exact: boolean;              // angleDegrees <= 45
}
export function selectPhotoView(
  object: Pick<SceneObject, "position" | "rotation" | "type">,
  set: PhotoAssetSet,
): SelectedPhotoView;
```

Rules, in order:

1. `radial`: return the first view, not mirrored, `angleDegrees = 0`, `exact`.
2. Build candidates: every view as-is and, when `symmetry !== "radial"`, every
   view mirrored (`frontVector.x` negated, `anchorX` becomes `1 - anchorX`).
   For `front-back` symmetry also consider the object facing negated, keeping
   whichever gives the smaller angle.
3. Score each candidate by the angle between `facingOf(rotation[1])` and the
   candidate front vector. Pick the smallest angle.
4. Ties within `1e-7` degrees (a `yaw = 0` object against the front-quarter pair
   is the common case) resolve toward the room centre: when `position[0] <= 0`
   prefer the candidate whose `frontVector.x > 0` (the photographed
   orientation, so an object on the centre line keeps its native cutout),
   otherwise prefer `frontVector.x <= 0`. Remaining ties prefer `photographed`
   over `generated`, then not-mirrored, then source order.
5. `exact` is `angleDegrees <= 45`.

The seed sofa (`x = -1.7`, `yaw = 0`) therefore keeps today's un-mirrored
cutout, and a chair on the right of the room (`x > 0`, `yaw = 0`) shows the
mirrored cutout, facing the room centre.

### 6.1 Rendering

`PhotoObjectLayer` no longer applies `rotate(...)` to the frame and the
`--photo-rotation` custom property and its counter-rotation rule in
`demo-workspace.module.css` are removed. The selected view's `src`, intrinsic
size, and (possibly mirrored) anchor drive the frame; a mirrored view renders
the `<img>` with `transform: scaleX(-1)`. Floor anchor, rotation handle, lock
badge, contact shadow, and selection frame keep agreeing on the mirrored anchor.
Contact shadows keep using the physical footprint (already rotation-aware).
The `<img>` gets `data-photo-view="<view>"` and `data-photo-mirrored="true|false"`
so tests and the inspector can read the choice.

When `exact` is false the frame carries `data-photo-approximate="true"` and the
inspector shows "Approximate view" beside the facing row. The object is still
rendered with the nearest view; nothing is hidden.

### 6.2 Inspector

The object inspector adds a `Facing` row: `x 0.00 · z 1.00 · front-quarter`
(with ` · mirrored` when mirrored and ` · approximate` when not exact). Rotation
stays displayed in degrees.

## 7. WebMCP Contract

### 7.1 Outputs

`get_scene` returns the Scene with every object extended by
`facing: { x, z }` (derived, unit length, 4-decimal rounding). `get_selection`
returns the selected object extended the same way. `tool-contracts.ts` exports
`ToolSceneObjectSchema = SceneObjectSchema.extend({ facing })` and
`ToolSceneSchema` for consumers and tests; the stored `SceneSchema` is unchanged.

### 7.2 `move_object` input

```ts
facing: z.object({ x: z.number().finite(), z: z.number().finite() }).strict().optional()
```

`facing` and `rotationYDegrees` are mutually exclusive; both present is an
`INVALID_INPUT` with issue path `facing`. A zero-length facing (`|v| < 1e-6`)
is `INVALID_INPUT` with path `facing`. A valid facing sets
`rotationYDegrees = rotationYOf(normalizeFacing(facing)) * 180 / π` before the
existing move command runs, so the store, history, revision, and stale-state
behaviour do not change. The JSON schema gains the same optional property.

### 7.3 Descriptions and evals

Tool descriptions mention that facing is a unit XZ vector where `{x:0,z:1}`
faces the camera side (front wall) and `{x:0,z:-1}` faces the back wall.
`tests/evals/webmcp-journeys.json` gains `face-the-sofa`: prompt "Turn the
chair to face the sofa", expected tools `get_scene`, `move_object`, assertions
that `move_object` is called with `facing` pointing from the chair toward the
sofa and that the returned scene's chair `facing` matches within 0.01.

## 8. Placement Solver

### 8.1 Rotation options input

```ts
export interface RotationOption { rotationY: number; fidelity: number } // fidelity in (0, 1]
export interface PlacementOptions {
  rotationOptions?: Readonly<Record<string, readonly RotationOption[]>>; // by object id
}
export function proposeNaturalPlacement(scene: Scene, options?: PlacementOptions): NaturalPlacementResult;
```

Without options, or for an object with no entry, the solver preserves that
object's current Y rotation with fidelity 1 (today's behaviour). Rugs ignore
options. The command adapter (`natural-placement-command.ts` caller in the
store) builds options from the view registry with:

```ts
export function rotationOptionsFor(object: SceneObject, set: PhotoAssetSet | null): readonly RotationOption[];
```

which returns, for the eight yaws `k * 45°` (`k = -3..4`), those whose
`viewFidelity` is above 0, always including the object's current rotation with
its own fidelity (or 1 when the object has no registered set). `viewFidelity`
is the highest origin weight among views (with mirrors and symmetry as in
section 6) whose front vector lies within 45° of the facing; origin weights are
`photographed` 1.0 and `generated` 0.8, and a mirrored candidate multiplies by
0.95. `radial` objects have a single option: their current rotation, fidelity 1.

With only photographed views the options are `{0, ±45°}` for sofas and chairs
and `{0, ±45°, ±135°, 180°}` for coffee tables; with the full generated set
every 45° step is available.

### 8.2 Candidates

- Sofa: for each rotation option, one sweep along every wall that option can
  back onto (existing `usableSofaWalls` per rotation), plus the current placement.
- Coffee table and rug: unchanged, measured along the chosen sofa's forward axis.
- Chair: three families, each only when the required rotation is among the
  chair's options, quantised to the 0.1m grid:
  1. **flank** (preferred): beside either sofa end, centre offset along the
     sofa's lateral axis by `sofa.halfWidth + chair.halfWidth + gap` with
     `gap ∈ {0.15, 0.3}`, forward offset `{0.2, 0.5}` toward the table, rotation
     `sofaYaw ∓ 45°` turning the chair toward the table (left end turns right,
     right end turns left).
  2. **across**: beyond the table on the sofa's forward axis, lateral offsets
     `{0, ±0.3}`, rotation `sofaYaw + 180°`.
  3. **side of table**: on the table's lateral side, lateral offset
     `table.halfWidth + chair.halfDepth + {0.3, 0.5}`, rotation `sofaYaw ± 90°`
     facing the table.
  The incumbent placement stays in the list.
- Floor lamp and plant: the perimeter ring stays, plus **sofa-end** candidates
  for lamps: beside either sofa end (lateral gap `{0.1, 0.25}`, aligned with the
  sofa's back edge), rotation unchanged.

The per-object candidate cap (48) and beam width (32) are unchanged.

### 8.3 Scoring

Weights sum to 10,000:

| term            | weight | change |
|-----------------|--------|--------|
| circulation     | 2300   | was 2500 |
| sofaWallAndSide | 1500   | was 1700 |
| tableRelation   | 1600   | was 1800 |
| rugRelation     | 1400   | was 1600 |
| chairRelation   | 1000   | rewritten |
| accessories     | 600    | was 800 |
| movement        | 400    | was 600 |
| viewFidelity    | 600    | new |
| composition     | 600    | new |

`chairRelation` (0..1000): `facingTerm` = clamp(dot(chairFacing, unit vector
from chair centre to table centre), 0, 1) weighted 5; `distanceTerm` =
proximity of the chair-to-table edge gap to 0.45m over a 0.6m range weighted 3;
`spreadTerm` = 1 when the chair's lateral offset from the sofa's centre axis is
at least `sofa.halfWidth * 0.6` or the chair lies beyond the table on the
forward axis, else 0, weighted 2.

`viewFidelity` (0..1000): mean over movable non-rug objects of the fidelity of
their proposed rotation (from the options table; 1 when the object has no
entry), times 1000, rounded.

`composition` (0..1000), mean over movable non-rug objects of:
- foreground term: 1 when the footprint's maximum `z` is at most
  `room.depth / 2 - 1.0`, falling linearly to 0 at `room.depth / 2 - 0.1`;
- lamp adjacency (floor lamps only, replaces the foreground term for them at
  weight 1:1): proximity of the lateral edge gap to a sofa end to 0.15m over
  0.5m, 0 when there is no sofa or the lamp is not within the sofa's depth band;
- plant corner term (plants only, 1:1 with the foreground term): 1 when both
  the `x` and `z` wall gaps are at most 0.3m, 0.5 when one is, else 0.

Every term is quantised from millimetres exactly as the existing terms are.

### 8.4 Hard constraints

Unchanged, plus: a proposed rotation must be one of the object's options
(the candidate generators guarantee it; the command adapter re-validates
against `rotationOptionsFor` and rejects the whole proposal as
`invalid-input` otherwise).

### 8.5 Expected demo outcome

The demo room's back window (offset 0.62) casts an opening clearance zone of
x ∈ [-0.18, 1.62], z ∈ [-2.4, -1.65]. A sofa square on the back wall must
therefore sit at x ≤ -1.2, which leaves no valid position for a chair flanking
either sofa end (verified by exhaustive enumeration over the flank family), and
the weight table itself prefers the corner composition below (9431 vs 9212 with
the sofa pinned to rotation 0). The accepted staged composition is:

- sofa quarter-turned into the back-left corner, facing the room centre
  (the native front-quarter cutout is 10° from a -45° facing, so the picture
  matches the geometry);
- table and rug in front of the sofa along its forward axis;
- chair flanking the sofa's right end, turned 45° toward the table (mirrored
  front-quarter view);
- lamp beside the sofa's left end; plant in the back-left corner behind the
  sofa; nothing colliding, the window clearance and the circulation path free.

Pinned coordinates (room metres, Y rotation in degrees) for the poor-journey
scene the browser journey drives, with photographed views only:

| object   | x    | z    | rotation |
|----------|------|------|----------|
| sofa_01  | -1.3 | -1.1 | -45      |
| table_01 | -0.3 |  0.1 | 0        |
| rug_01   | -0.3 |  0.2 | -45      |
| chair_01 |  0.8 | -1.0 | +45      |
| lamp_01  | -2.6 |  0.0 | 0        |
| plant_01 | -2.4 | -1.7 | 0        |

The seed demo scene arranges to the same composition — sofa (-1.3, -1.2) at
-45°, table and rug (-0.2, -0.1), lamp (-2.7, -0.5), chair (0.7, -1.0) at +45°,
plant (-2.625, -2.025); both tables are pinned by the unit tests. "Sofa at the
back" is asserted on the centre (z ≤ -0.9) and the footprint's minimum z
(< -2.2, flush on the wall): a quarter-turned sofa's front corner swings
forward to about z = 0.
The flank family therefore offers forward offsets {0.2, 0.5, 0.8} m: the first
two land inside the 0.75 m opening clearance on the sofa's own wall.

## 9. Generation Pipeline

### 9.1 Command

`pnpm assets:views [--dry-run] [--product <assetId>]... [--view <name>]... [--force]`
runs `scripts/openinterior-assets/generate-views.ts` with `tsx`.

- Loads `.env.local` with `process.loadEnvFile` when present; never reads
  `.env` files anywhere else. Required: `OPENAI_API_KEY` (absent → exits 2 with
  a message, except `--dry-run`, which prints the plan and exits 0).
- Optional env: `OPENINTERIOR_IMAGE_MODEL` (default `gpt-image-1`),
  `OPENINTERIOR_IMAGE_QUALITY` (`low|medium|high`, default `high`).
- Plans one job per missing `(assetId, view)` for base assets whose symmetry is
  `none` (views `side`, `back-quarter`, `back`) or `front-back` (view `side`).
  Radial assets and rugs are skipped. Existing manifest entries are skipped
  unless `--force`.
- Each job: `POST https://api.openai.com/v1/images/edits` multipart with
  `model`, `image` (the photographed WebP), `prompt`, `background=transparent`,
  `output_format=webp`, `output_compression=100`, `size` = `1536x1024` when the
  reference is landscape else `1024x1536`, `quality`, `input_fidelity=high`,
  `n=1`. Retries HTTP 429/5xx three times with 2s, 4s, 8s waits. Any other
  failure aborts the run after writing the manifest for completed jobs.
- Output file: `public/demo/photo/products/<assetId>--<view>.webp` (seed assets
  under `public/demo/photo/seed/`). Anchor: over pixels with alpha ≥ 16,
  `anchorX = (left + right + 1) / 2 / width`, `anchorY = (bottom + 1) / height`,
  rounded to 4 decimals; an image with no such pixel fails the job.
- Manifest entries are merged by `(assetId, view)`, sorted by `assetId` then
  view order, and written as the TypeScript module described in section 5.2
  (a header comment naming the generator, then the exported constant,
  pretty-printed with two-space indentation).

### 9.2 Prompt

```
Product photography of the exact same {category} shown in the reference image,
viewed from {viewDescription}. Keep the identical design, materials, colors,
proportions, and lighting. Same camera height and lens, centered, the whole
product visible with a small margin, standing on an invisible floor. Isolated
on a fully transparent background with no shadow, no floor, no props, no text.
```

`{category}` is the human label (`sofa`, `coffee table`, `armchair`, `floor
lamp`, `plant`). `{viewDescription}`: `side` → "its right side, a pure
90-degree profile with the front of the {category} pointing to the viewer's
right"; `back-quarter` → "behind and to the right, a three-quarter rear view
with the back facing the camera and the front pointing away to the viewer's
right"; `back` → "directly behind, showing only the back of the {category}".

### 9.3 Pure core and I/O shell

`scripts/openinterior-assets/view-jobs.ts` holds the pure parts: argument
parsing, job planning from the registry and manifest, prompt building, the
multipart field list, anchor measurement from an RGBA buffer, and manifest
merging. `generate-views.ts` is the shell: env, `fetch`, `sharp` decode/encode,
file writes. `sharp` is a devDependency used only by the script.

### 9.4 Boundaries

The script is never imported by the app, tests never call the network, CI never
runs it, and the key is never logged. `.env.example` replaces the unused
`TRIPO_*`/`ROOM_AI_*` block with `OPENAI_API_KEY=`,
`OPENINTERIOR_IMAGE_MODEL=gpt-image-1`, `OPENINTERIOR_IMAGE_QUALITY=high`,
documented as script-only variables.

## 10. Failure Handling

- Missing generated file at runtime: the existing labelled fallback, as today.
- Manifest invalid: the app throws at module load in development and tests;
  the manifest is validated by a unit test so a bad commit fails CI.
- Object with no registered set (uploads, unknown type): rendered by the
  existing fallback; solver options default to current rotation, fidelity 1.
- Human rotates to an uncovered facing: nearest view, `approximate` disclosure.
- `move_object` facing errors are `INVALID_INPUT` and mutate nothing.

## 11. Testing

Unit: facing math round trips; `selectPhotoView` picks, mirrors, ties toward
centre, symmetry, approximate flag; registry/manifest validation; solver
options, fidelity, candidates, scoring, determinism, and the pinned seed layout;
`move_object` facing input (valid, zero vector, both fields); tool outputs carry
`facing`; pipeline pure core (planning, prompt, multipart fields, anchor from a
synthetic RGBA buffer, manifest merge, dry-run and missing-key behaviour with a
fake fetch that must not be called).

Component (`room-photo-stage.test.tsx`): mirrored chair renders `scaleX(-1)`
with a mirrored anchor; no `rotate(` in the frame transform; approximate
marker after a keyboard rotation to 90° when no side view exists.

E2E (`photo-compositor.spec.ts`): after "Arrange naturally" the chair frame has
`data-photo-mirrored="true"` and no frame transform contains `rotate(`; the
arranged layout satisfies the same collision/opening/circulation checks; the
existing p95 gate stays. `photo-assets.spec.ts` audits every generated view
present in the manifest in addition to the 26 base images.

Full gate before completion: `pnpm test`, `pnpm typecheck`, `pnpm lint`,
`pnpm test:e2e`, `pnpm build:next`.

## 12. Documentation

`docs/asset-views.md` (pipeline, prompt, env, cost note, how a shop runs it),
README section "Facing and views", `AGENTS.md` rule: when a view or facing
contract changes, update registry, compositor, solver options, tool contracts,
tests, and evals together; the pipeline is the only place that calls an image
model.

## 13. Acceptance Criteria

1. No vertical cutout is rendered with a CSS rotation; every one is a
   registered view, optionally mirrored, chosen by front vector.
2. `get_scene`/`get_selection` expose `facing`; `move_object` accepts `facing`.
3. The solver turns only toward truthful views, and the seed demo arrangement
   matches section 8.5.
4. `pnpm assets:views --dry-run` lists the 28 jobs for the demo catalog with no
   network access; with a key it produces registered, anchored WebP views.
5. All gates in section 11 pass; the p95 placement gate is unchanged.
