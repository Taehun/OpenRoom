# Nook Hybrid Image Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the static photo compositor, prove a geometry-locked browser WebGPU harmonizer in a hard-gated spike, and only on a passing spike add an optional local image-enhancement layer that preserves Nook's canonical Scene and Core 6 behavior.

**Architecture:** The existing DOM compositor remains the immediate editor and universal fallback. Successful existing `replace` and `move` commands emit an isolated post-commit receipt to a latest-wins renderer controller; a dedicated worker composes registered assets, runs pinned ONNX Runtime Web 1.29.0 through WebGPU, enforces immutable geometry and product-quality gates, and returns a result that is shown only when `sceneId`, `revision`, and `contentHash` still match.

**Tech Stack:** Next.js 16.3.3 App Router, React 19.2.8, TypeScript 5, Zustand 5, Zod 4, CSS Modules, Web Worker, OffscreenCanvas, Cache Storage, IndexedDB, ONNX Runtime Web 1.29.0/WebGPU, Vitest 4, React Testing Library, Playwright 1.62, static WebP assets.

**Spec:** `docs/superpowers/specs/nook-hybrid-image-renderer-design.md`

## Global Constraints

- Work only in `/Users/taehun/Projects/WebMCP/.worktrees/photo-compositor` on `feat/photo-compositor`.
- Do not modify `docs/superpowers/specs/2026-09-01-nook-photo-compositor-design.md`.
- Before editing React, Next, worker, CSS, or test code, read the relevant installed Next 16.3.3 guides from `node_modules/next/dist/docs/` and follow current deprecations.
- `Scene` JSON, Zustand, and the existing command layer remain the only canonical room state and mutation route.
- Preserve object IDs, revision semantics, monotonic `stateVersion`, selection, locks, undo/reset, registration cleanup, and structured errors.
- Preserve exactly the WebMCP Core 6. Do not add a generic execute, render, image, batch, or model tool.
- `add_scene_to_cart` continues to open only the local approval UI and must produce no external write.
- DOM cutouts remain the immediate visual preview, accessible buttons, and transparent hit layer when an accepted raster is visible.
- Only successful committed `replace` and `move` operations may schedule internal rendering.
- A result is visible only when current `sceneId`, `revision`, `contentHash`, model version, and render-profile version all match.
- No model request occurs before explicit version-specific user consent.
- Cache Storage holds verified model shards; IndexedDB holds only small manifest/consent/completeness metadata. Rendered room images are memory-only.
- Unsupported WebGPU, cancellation, quota failure, integrity failure, OOM, device loss, worker failure, or quality failure returns to the complete DOM compositor.
- No server/API key, photo upload, Scene upload, prompt upload, model API, analytics SDK, external cart write, or local MCP companion is included.
- Do not merge, push, create a pull request, or deploy.
- Stop before Task 5 unless Tasks 1-4 are green. Stop after Task 5 if any spike gate fails. Tasks 6-11 are conditional on a documented `PASS` spike verdict.

## File Map

Photo repair phase:

- Modify `src/features/photo/room-photo-stage.tsx` — start-relative move/rotation gesture math.
- Modify `src/features/photo/photo-object-layer.tsx` — anchored visual frame, image-error state, semantic hit layer.
- Modify `src/features/photo/photo-projection.ts` — one depth-scale calculation and category-aware width bounds.
- Modify `src/features/photo/photo-assets.ts` — exact room/cutout registry contracts.
- Modify `src/features/demo/demo-workspace.module.css` — anchor-aware frame/handle/marker and visible copy status.
- Modify `src/features/demo/room-canvas.tsx` — sighted clipboard status feedback.
- Modify `public/demo/photo/nook-room-empty.webp` — exact 1600x900 crop.
- Modify `public/demo/photo/nook-room-before.webp` — exact 1600x900 crop.
- Modify focused unit/E2E tests and handoff documentation.
- Create `tests/helpers/webp-metadata.ts` — portable RIFF/WebP dimension and alpha-feature parser.
- Create `tests/e2e/photo-assets.spec.ts` — browser decode and real alpha-pixel audit.

Spike phase:

- Create `docs/superpowers/spikes/2026-09-02-nook-webgpu-renderer.md` — legal, format, cold/warm/offline, memory, latency, privacy, and quality verdict.
- Use `/tmp/nook-webgpu-renderer-spike` for all throwaway conversion code, environments, downloads, profiles, and generated images.

Conditional product phase:

- Create `src/features/photo/renderer/render-snapshot.ts` — immutable render input, canonical JSON, SHA-256, render key.
- Create `src/features/photo/renderer/worker-protocol.ts` — strict request/result/progress/error messages.
- Create `src/features/photo/renderer/quality-gates.ts` — immutable-alpha, bounds, changed-pixel, clipping, and SSIM checks.
- Create `src/features/photo/renderer/model-manifest.ts` — exact approved model/shard manifest from the passing spike.
- Create `src/features/photo/renderer/model-cache.ts` — explicit download, per-shard verification, Cache Storage, IndexedDB, offline, delete.
- Create `src/features/photo/renderer/renderer-controller.ts` — lifecycle, latest-wins queue, result validation, circuit breaker.
- Create `src/features/photo/renderer/renderer-worker.ts` — WebGPU/ORT session, deterministic composition, bounded harmonization, transferable result.
- Create `src/features/photo/renderer/renderer-worker-client.ts` — typed main-thread module-worker ownership and cleanup.
- Create `src/features/photo/renderer/renderer-context.tsx` — one demo runtime/controller and React subscription boundary.
- Create `src/features/photo/renderer/hybrid-render-layer.tsx` — accepted 16:9 raster canvas.
- Create `src/features/photo/renderer/enhanced-rendering-status.tsx` — consent, byte progress, cancel, retry, cache delete, visible/live status.
- Modify `src/features/scene/scene-store.ts` and `src/features/scene/scene-context.tsx` — optional isolated post-success observer.
- Modify `src/features/demo/demo-workspace.tsx`, `room-canvas.tsx`, `room-photo-stage.tsx`, `photo-object-layer.tsx`, and CSS — runtime wiring without tool changes.
- Create focused unit/component tests plus `tests/e2e/hybrid-renderer.spec.ts`.

## Spec Coverage Index

| Approved spec area | Plan coverage |
| --- | --- |
| Photo gesture, anchor, scale, asset, clipboard, E2E, and injection repairs | Tasks 1-4 |
| Hard-gated model format/license/performance/quality spike | Task 5 |
| Render snapshot, revision-ABA hash, result identity | Tasks 6 and 8 |
| Strict worker protocol and dedicated WebGPU worker | Tasks 6 and 9 |
| Immutable alpha, bounded shadow, automatic product-quality checks | Tasks 6 and 9 |
| Explicit consent, byte progress, cancellation, verified cache, offline/delete | Tasks 7 and 10 |
| Successful-command-only scheduling and latest-wins discard | Task 8 |
| DOM preview, raster layer, transparent semantic hit layer, visible failure UI | Task 10 |
| Privacy/network invariant, fake-worker E2E, real WebGPU smoke, full matrix | Task 11 |
| Core 6, Scene, revision, stateVersion, undo, selection, cleanup, cart boundaries | Tasks 1-4, 8, 10, and 11 |

---

### Task 1: Start-Relative Gestures, Asset Anchors, and Single Depth Scale

**Files:**

- Modify: `src/features/photo/room-photo-stage.tsx`
- Modify: `src/features/photo/photo-object-layer.tsx`
- Modify: `src/features/photo/photo-projection.ts`
- Modify: `src/features/demo/demo-workspace.module.css`
- Test: `tests/unit/room-photo-stage.test.tsx`
- Test: `tests/unit/photo-projection.test.ts`

**Interfaces:**

- Consumes: normalized stage pointers, starting projected floor anchor, starting Scene transform, `PhotoAsset.anchorX/anchorY`, object category and physical width.
- Produces: `TransformPreview` with start-relative gesture fields, `normalizeAngleDelta()`, and `objectVisualWidth(widthM, depthScale, category)` with depth applied exactly once.

- [ ] **Step 1: Read the installed framework guides**

Run:

```bash
sed -n '1,240p' node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/01-getting-started/11-css.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md
```

Verify the files describe the installed Next 16.3.3 client boundary,
CSS Modules, and Vitest integration. Record any changed rule in the task report
before editing.

- [ ] **Step 2: Add RED gesture tests**

Extend `tests/unit/room-photo-stage.test.tsx` with exact cases:

```tsx
test("moves by the pointer delta without jumping the floor anchor", () => {
  const store = createSceneStore();
  const start = structuredClone(objectFromStore(store, "table_01"));
  renderStage(store);
  const table = screen.getByRole("button", { name: "Coffee table" });

  fireEvent.pointerDown(table, { pointerId: 31, clientX: 430, clientY: 360 });
  fireEvent.pointerMove(table, { pointerId: 31, clientX: 430, clientY: 360 });
  fireEvent.pointerUp(table, { pointerId: 31, clientX: 430, clientY: 360 });

  expect(objectFromStore(store, "table_01").position).toEqual(start.position);
  expect(store.getState().scene.revision).toBe(1);
});

test("adds rotation pointer-angle delta to the starting rotation", () => {
  const scene = createDemoScene();
  scene.objects.find(({ id }) => id === "table_01")!.rotation[1] = Math.PI / 3;
  const store = createSceneStore(scene);
  store.getState().setToolMode("rotate");
  renderStage(store);
  const handle = screen.getByRole("button", { name: "Rotate Coffee table" });

  fireEvent.pointerDown(handle, { pointerId: 32, clientX: 500, clientY: 250 });
  fireEvent.pointerMove(handle, { pointerId: 32, clientX: 500, clientY: 250 });
  fireEvent.pointerUp(handle, { pointerId: 32, clientX: 500, clientY: 250 });

  expect(objectFromStore(store, "table_01").rotation[1]).toBeCloseTo(Math.PI / 3);
  expect(store.getState().scene.revision).toBe(1);
});
```

Add a third test that moves the same 60px/30px pointer delta from two different
places inside the cutout and expects the same Scene delta, and a fourth that
crosses the `-π/π` boundary and expects the shortest signed angle delta.

- [ ] **Step 3: Add RED anchor and depth-width tests**

Assert the rendered frame exposes the exact table registry anchors, the floor
marker uses those variables, the handle is positioned from the same anchor,
and no object transform contains `scale(`:

```tsx
const frame = screen.getByTestId("photo-object-frame-table_01");
expect(frame.style.getPropertyValue("--photo-anchor-x")).toBe("50.07%");
expect(frame.style.getPropertyValue("--photo-anchor-y")).toBe("86.13%");
expect(frame.style.transform).not.toContain("scale(");
```

Replace the old 58%-clamp projection assertion with:

```ts
expect(objectVisualWidth(2, 0.8, "sofa")).toBeCloseTo(28.8);
expect(objectVisualWidth(2.2, 0.8, "sofa"))
  .toBeGreaterThan(objectVisualWidth(1.8, 0.8, "sofa"));
expect(objectVisualWidth(0.45, 1, "floor_lamp")).toBeCloseTo(8.1);
```

- [ ] **Step 4: Run the focused tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/photo-projection.test.ts tests/unit/room-photo-stage.test.tsx
```

Expected: failures show absolute pointer projection, absolute rotation angle,
unused registry anchors, CSS depth `scale()`, and the global 58% clamp.

- [ ] **Step 5: Implement start-relative gesture state**

Change the transient shape to:

```ts
interface TransformPreview {
  kind: "move" | "rotate";
  pointerId: number;
  objectId: string;
  startPointer: NormalizedPoint;
  startAnchor: NormalizedPoint;
  startPointerAngle: number;
  startPosition: Vec3;
  startRotationY: number;
  position: Vec3;
  rotationY: number;
  changed: boolean;
}
```

For move preview, compute `pointerDelta = currentPointer - startPointer`, add it
to `startAnchor`, inverse-project that target anchor, and retain
`startPosition[1]`. For rotation preview, compute the current pointer angle
around `startAnchor`, normalize the signed difference into `[-π, π]`, and set:

```ts
rotationY = startRotationY + normalizeAngleDelta(
  currentPointerAngle - startPointerAngle,
);
```

Use functional `setTransformPreview(current => ...)` updates so queued pointer
events cannot read an older closure. Preserve first-pointer ownership,
pointer-cancel zero-commit behavior, and one commit on changed pointer-up.

- [ ] **Step 6: Implement the anchored object frame**

Render a noninteractive positioned wrapper containing sibling object and rotate
buttons. Set these variables from the resolved asset, falling back to `0.5/1`:

```ts
"--photo-anchor-x": `${anchorX * 100}%`,
"--photo-anchor-y": `${anchorY * 100}%`,
"--photo-anchor-x-offset": `${anchorX * -100}%`,
"--photo-anchor-y-offset": `${anchorY * -100}%`,
```

The wrapper owns `left`, `top`, `width`, z-index, translation, rotation, and
transform origin. The object button fills the wrapper. Place `.floorAnchor` at
`left/top: var(--photo-anchor-x/y)`. Place the sibling rotation handle at
`left: var(--photo-anchor-x); top: 0`, with a counter-rotation only for the
glyph. Keep the object and rotation controls as separate semantic buttons; do
not nest buttons.

- [ ] **Step 7: Apply depth scale once**

Change the signature to:

```ts
export function objectVisualWidth(
  widthM: number,
  depthScale: number,
  type: SceneObjectType,
): number;
```

Compute `widthM * 18 * depthScale` and clamp by category:

```ts
const VISUAL_WIDTH_BOUNDS = {
  sofa: [24, 52],
  coffee_table: [10, 36],
  rug: [20, 56],
  floor_lamp: [6, 20],
  chair: [10, 32],
  plant: [8, 26],
  unknown: [8, 56],
} as const;
```

Remove CSS `scale(var(--photo-scale))`. Keep `placement.scale` only as the one
input to width calculation and optional diagnostics. Pass `object.type` from
`RoomPhotoStage`.

- [ ] **Step 8: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/photo-projection.test.ts tests/unit/room-photo-stage.test.tsx
pnpm run typecheck
pnpm run lint
git diff --check
```

Commit only these files:

```bash
git add src/features/photo/room-photo-stage.tsx src/features/photo/photo-object-layer.tsx src/features/photo/photo-projection.ts src/features/demo/demo-workspace.module.css tests/unit/room-photo-stage.test.tsx tests/unit/photo-projection.test.ts
git commit -m "fix(photo): preserve gesture and asset anchors"
```

---

### Task 2: Complete Asset Integrity, Exact Room Grid, and Load-Failure Fallback

**Files:**

- Modify: `src/features/photo/photo-assets.ts`
- Modify: `src/features/photo/photo-object-layer.tsx`
- Modify: `public/demo/photo/nook-room-empty.webp`
- Modify: `public/demo/photo/nook-room-before.webp`
- Modify: `tests/unit/photo-assets.test.ts`
- Modify: `tests/unit/room-photo-stage.test.tsx`
- Create: `tests/helpers/webp-metadata.ts`
- Create: `tests/e2e/photo-assets.spec.ts`

**Interfaces:**

- Consumes: two room WebPs, six seed cutouts, eighteen catalog cutouts, explicit registry metadata.
- Produces: `ROOM_PHOTO_ASSETS`, exact 26-file cardinality, portable WebP metadata validation, and `<img>` error fallback keyed to the current source.

- [ ] **Step 1: Write a RED portable WebP metadata parser test**

Create `tests/helpers/webp-metadata.ts` with:

```ts
export interface WebpMetadata {
  width: number;
  height: number;
  hasAlpha: boolean;
  format: "VP8" | "VP8L" | "VP8X";
}

export function readWebpMetadata(path: string): WebpMetadata;
```

Parse RIFF/WEBP chunks directly with `node:fs`: VP8 lossy frame dimensions,
VP8L packed width/height/alpha flag, and VP8X canvas dimensions/alpha flag.
Reject invalid signatures, truncated chunks, missing image chunks, and zero
dimensions. Do not shell out to macOS `sips`, ImageMagick, or WebP CLI in tests.

Extend `tests/unit/photo-assets.test.ts` to require:

```ts
expect(Object.keys(ROOM_PHOTO_ASSETS)).toHaveLength(2);
expect(Object.keys(PHOTO_ASSETS)).toHaveLength(24);
expect(Object.keys(ROOM_PHOTO_ASSETS).length + Object.keys(PHOTO_ASSETS).length)
  .toBe(26);
```

For both rooms, require metadata and registry dimensions to equal `1600x900`
and `hasAlpha` to be false. For every cutout, require file dimensions to equal
its registry values and `hasAlpha` to be true.

- [ ] **Step 2: Write RED registered-image failure tests**

Add component tests that dispatch `error` on a valid registered table image and
assert the same outer button remains labelled/selectable with `Coffee table
preview unavailable`. Rerender with `table_01.assetId` changed to
`travertine-plinth-table`, assert the new `<img src>` is restored, then dispatch
its own error and assert fallback again.

The state contract is a source-keyed child so React resets local failure state
when `src` changes without a state-setting effect:

```ts
function PhotoAssetImage({ asset, label }: { asset: PhotoAsset; label: string }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <PhotoAssetFallback label={label} />
    : <img alt="" draggable={false} onError={() => setFailed(true)} src={asset.src} />;
}

// Parent:
<PhotoAssetImage key={asset.src} asset={asset} label={label} />
```

A source change mounts a new keyed child with `failed === false`. No global
failed-asset set is introduced.

- [ ] **Step 3: Run unit tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/photo-assets.test.ts tests/unit/room-photo-stage.test.tsx
```

Expected: room dimension mismatch, missing room registry, and missing image
error fallback failures.

- [ ] **Step 4: Re-crop both room images to the same exact grid**

Use ImageMagick only as an implementation-time asset rewrite, not a runtime or
test dependency:

```bash
magick public/demo/photo/nook-room-empty.webp -resize '1600x900^' -gravity center -extent 1600x900 -quality 92 /tmp/nook-room-empty-1600x900.webp
magick public/demo/photo/nook-room-before.webp -resize '1600x900^' -gravity center -extent 1600x900 -quality 92 /tmp/nook-room-before-1600x900.webp
mv /tmp/nook-room-empty-1600x900.webp public/demo/photo/nook-room-empty.webp
mv /tmp/nook-room-before-1600x900.webp public/demo/photo/nook-room-before.webp
```

Inspect both outputs at native resolution before continuing. Reject a crop that
changes the floor horizon, clips a room edge needed by the stage, or moves the
camera center inconsistently; adjust one explicit shared gravity/offset and
rerun both commands together if correction is required.

- [ ] **Step 5: Implement exact room registry and image fallback**

Add:

```ts
export const ROOM_PHOTO_ASSETS = {
  empty: { id: "nook-room-empty", src: "/demo/photo/nook-room-empty.webp", intrinsicWidth: 1600, intrinsicHeight: 900 },
  before: { id: "nook-room-before", src: "/demo/photo/nook-room-before.webp", intrinsicWidth: 1600, intrinsicHeight: 900 },
} as const;

export const NOOK_ROOM_BACKGROUND = ROOM_PHOTO_ASSETS.empty.src;
export const NOOK_ROOM_BEFORE = ROOM_PHOTO_ASSETS.before.src;
```

In `PhotoObjectLayer`, render the keyed `PhotoAssetImage` when the registry
resolves an asset. Render the same labelled `PhotoAssetFallback` for both a
missing registry record and a failed registered source. Keep the outer object
button mounted through both paths.

- [ ] **Step 6: Add a real browser alpha-pixel audit**

Create `tests/e2e/photo-assets.spec.ts`. Load all 26 paths in the page, draw
each decoded image into a scratch canvas, and return `naturalWidth`,
`naturalHeight`, minimum alpha, and maximum alpha. Assert both rooms are
1600x900 and fully opaque. Assert each of the 24 cutouts matches registry
dimensions and contains both transparent (`alpha === 0`) and visible
(`alpha > 0`) pixels. Fail with the exact asset ID in the assertion message.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/photo-assets.test.ts tests/unit/room-photo-stage.test.tsx
pnpm exec playwright test tests/e2e/photo-assets.spec.ts --config=playwright.config.ts
pnpm run typecheck
pnpm run lint
git diff --check
```

Commit:

```bash
git add public/demo/photo/nook-room-empty.webp public/demo/photo/nook-room-before.webp src/features/photo/photo-assets.ts src/features/photo/photo-object-layer.tsx tests/helpers/webp-metadata.ts tests/unit/photo-assets.test.ts tests/unit/room-photo-stage.test.tsx tests/e2e/photo-assets.spec.ts
git commit -m "fix(photo): verify and recover photo assets"
```

---

### Task 3: Visible Clipboard Feedback, Stronger Stale E2E, and Lifecycle Documentation

**Files:**

- Modify: `src/features/demo/room-canvas.tsx`
- Modify: `src/features/demo/demo-workspace.module.css`
- Modify: `tests/unit/demo-workspace.test.tsx`
- Modify: `tests/e2e/photo-compositor.spec.ts`
- Modify: `README.md`
- Modify: `docs/NEXT_SESSION.md`

**Interfaces:**

- Consumes: `navigator.clipboard.writeText`, existing prompt, captured Core 6 descriptors, document-lifetime WebMCP injection assumption.
- Produces: visible `copyStatus`, rejection coverage, a non-equal valid stale target, and exact focused Playwright commands.

- [ ] **Step 1: Add RED clipboard success and rejection tests**

Retain the successful clipboard spy and require visible text:

```tsx
await user.click(screen.getByRole("button", { name: "Copy redesign prompt" }));
expect(screen.getByRole("status", { name: "Prompt copy status" }))
  .toHaveTextContent("Prompt copied");
expect(screen.getByText("Prompt copied")).toBeVisible();
```

Add a separate rejected promise test:

```tsx
vi.spyOn(navigator.clipboard, "writeText")
  .mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
const before = await getScene.execute({}, { signal });
await user.click(screen.getByRole("button", { name: "Copy redesign prompt" }));
expect(screen.getByRole("status", { name: "Prompt copy status" }))
  .toHaveTextContent("Could not copy. Select and copy the prompt manually.");
const after = await getScene.execute({}, { signal });
expect(after.structuredContent.sceneRevision)
  .toBe(before.structuredContent.sceneRevision);
expect(after.structuredContent.stateVersion)
  .toBe(before.structuredContent.stateVersion);
```

Use the same captured `get_scene` descriptor and AbortSignal setup as the
existing successful-copy test; keep success and rejection as separate tests.

- [ ] **Step 2: Make the stale E2E target prove no mutation**

In `tests/e2e/photo-compositor.spec.ts`, assert the restored position is not the
target, then use this valid target:

```ts
const staleTarget = { x: 1.25, z: -0.75 };
expect(afterUndoTable?.position[0]).not.toBe(staleTarget.x);
expect(afterUndoTable?.position[2]).not.toBe(staleTarget.z);
```

Pass `staleTarget` to `move_object` with the stale revision. Retain exact Scene
and projected-style equality before/after the rejected call.

- [ ] **Step 3: Run focused tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/demo-workspace.test.tsx
pnpm exec playwright test tests/e2e/photo-compositor.spec.ts --config=playwright.config.ts
```

Expected: the sighted status assertion fails while the current status remains
visually hidden; the rejection copy is too terse before implementation.

- [ ] **Step 4: Implement sighted copy status**

Replace the visually hidden span with:

```tsx
<span
  aria-label="Prompt copy status"
  className={copyStatus.kind === "success" ? styles.copyStatusSuccess : styles.copyStatusError}
  role="status"
>
  {copyStatus.message}
</span>
```

Use a discriminated value with exact success and failure messages from Step 1.
Add compact visible styles that fit at both required viewports and do not move
the copy button after status appears.

- [ ] **Step 5: Correct commands and document injection lifetime**

Replace focused E2E examples that route a literal `--` through the test command
with direct Playwright form:

```bash
pnpm exec playwright test tests/e2e/photo-compositor.spec.ts tests/e2e/webmcp-core.spec.ts tests/e2e/demo-workspace.spec.ts tests/e2e/photo-assets.spec.ts --config=playwright.config.ts
```

In `README.md` and `docs/NEXT_SESSION.md`, state that native
`document.modelContext` is expected to be injected for the document lifetime
before React mounts. The current platform exposes no post-mount availability
event, so this package intentionally does not poll, monkey-patch, or dynamically
re-register. Unsupported documents keep the human editor.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/demo-workspace.test.tsx tests/unit/register-tools.test.tsx
pnpm exec playwright test tests/e2e/photo-compositor.spec.ts tests/e2e/webmcp-core.spec.ts tests/e2e/demo-workspace.spec.ts tests/e2e/photo-assets.spec.ts --config=playwright.config.ts
pnpm run typecheck
pnpm run lint
git diff --check
```

Commit:

```bash
git add src/features/demo/room-canvas.tsx src/features/demo/demo-workspace.module.css tests/unit/demo-workspace.test.tsx tests/e2e/photo-compositor.spec.ts README.md docs/NEXT_SESSION.md
git commit -m "fix(photo): surface copy and stale-state feedback"
```

---

### Task 4: Photo-Compositor Full Matrix, Visual QA, and Re-review Gate

**Files:**

- Modify only if evidence changed: `docs/NEXT_SESSION.md`
- Create local ignored evidence: `output/playwright/photo-final-review/*.png`

**Interfaces:**

- Consumes: Tasks 1-3 commits and existing Core 6/cart journeys.
- Produces: an integration-ready or with-fixes verdict. Only integration-ready permits Task 5.

- [ ] **Step 1: Run the focused regression set**

Run in this order and stop on first failure:

```bash
pnpm exec vitest run tests/unit/photo-projection.test.ts tests/unit/photo-assets.test.ts tests/unit/room-photo-stage.test.tsx tests/unit/demo-workspace.test.tsx tests/unit/register-tools.test.tsx tests/unit/webmcp-tools.test.ts
pnpm exec playwright test tests/e2e/photo-compositor.spec.ts tests/e2e/photo-assets.spec.ts tests/e2e/webmcp-core.spec.ts tests/e2e/demo-workspace.spec.ts --config=playwright.config.ts
```

- [ ] **Step 2: Run the complete required matrix**

Run in this exact order and stop on first failure:

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

Record exact files/tests, E2E journeys, build routes, warnings, and exit codes.

- [ ] **Step 3: Perform fresh visual and accessibility QA**

Start the exact project server without a literal separator argument:

```bash
pnpm exec next dev --hostname 127.0.0.1 --port 3000
```

Use a real browser at 1440x900 and 1280x800. Save seed and six-product redesign
screenshots under `output/playwright/photo-final-review/`. Verify object-center
drag has no anchor jump, a pre-rotated object has no rotation snap, physical
size differences remain visible, both room images use 1600x900, copy success
and failure are visible, registered-image error fallback remains selectable,
keyboard/focus/undo/reset/cart work, console has no application warning/error,
and cart observation records no external or mutation request. Stop the exact
server afterward.

- [ ] **Step 4: Run a fresh full-branch review**

Review `main...HEAD` with emphasis on the nine original final-review findings,
Scene/Core 6 invariants, binary asset changes, pointer ownership, CSS transform
geometry, and test quality. A verdict of `With fixes` or any higher-severity
finding blocks Task 5.

- [ ] **Step 5: Record a green handoff and commit only if needed**

If the matrix and re-review are green, update `docs/NEXT_SESSION.md` with exact
new counts, commit subjects, visual paths, and residual environment-only
warnings. Do not self-reference the documentation commit SHA.

```bash
git add docs/NEXT_SESSION.md
git diff --cached --check
git commit -m "docs: record photo compositor final review"
git status --short
```

Expected: clean `feat/photo-compositor`, no merge/push/deploy, and an explicit
integration-ready review verdict.

---

### Task 5: Hard-Gated WebGPU Model Spike

**Files:**

- Create: `docs/superpowers/spikes/2026-09-02-nook-webgpu-renderer.md`
- Temporary only: `/tmp/nook-webgpu-renderer-spike/**`

**Interfaces:**

- Consumes: fixed 1024x576 registered composites, Adobe PIH first candidate, Moebius second candidate, ONNX Runtime Web 1.29.0, latest stable Chromium WebGPU.
- Produces: concrete `SelectedModelManifest` JSON and `PASS`, or a measured `FAIL` that terminates this plan before Task 6.

- [ ] **Step 1: Start the four-hour clock and create isolated scratch space**

Record KST start time, current commit, OS, browser version, WebGPU adapter,
available memory, and `onnxruntime-web` 1.29.0. Create all harness and model
files in `/tmp/nook-webgpu-renderer-spike`; do not add model bytes, Python
environments, generated images, profiles, or conversion scripts to the repo.

- [ ] **Step 2: Verify primary-source license chains before download**

For PIH, record repository license, checkpoint download terms, checkpoint hash,
conversion-tool licenses, and redistribution/commercial-use permission. For
Moebius, record upstream code/weight Apache-2.0 terms, ONNX conversion artifact
terms, exact file list, byte sizes, and SHA-256 hashes. A missing explicit
weight or conversion-artifact grant rejects that candidate before inference.

- [ ] **Step 3: Convert or acquire at most two concrete ONNX candidates**

Externalize all tensors and target no more than 64 MiB per verified shard so
each shard can use `crypto.subtle.digest` without a full-model memory copy.
Record opset, input/output names, shapes, dtypes, dynamic axes, external-data
paths, total transfer/cache size, conversion command, and hashes. Reject any
candidate above 2 GB transfer or 2.5 GB verified cache.

- [ ] **Step 4: Build the throwaway worker harness**

The scratch harness must instantiate `onnxruntime-web/webgpu` inside a dedicated
module worker, load external data from Cache Storage, compose 1024x576
background/foreground/mask inputs, execute the candidate, apply original alpha,
and return an `ImageBitmap`. It must expose cold-download progress, cancel,
warm load, offline load, cache delete, ten-run timing, device loss, and worker
termination controls. Do not use the ORT proxy worker.

- [ ] **Step 5: Measure cold, cancel, warm, offline, and privacy behavior**

Capture request logs and prove:

- no model request before explicit harness consent;
- only manifest-pinned credentialless GETs occur during download;
- cancel stops network and UI within one second and leaves no ready marker;
- every shard hash verifies before the ready marker;
- warm cache reaches ready within 20 seconds and makes zero weight requests;
- complete cache works offline;
- missing/incomplete cache stays fallback without retry;
- cache delete removes model entries and retains room assets.

- [ ] **Step 6: Measure performance, memory, and stability**

Run ten 1024x576 renders and ten sequential changed composites. Record median,
p95, browser process memory, GPU process memory where reported, main-thread long
tasks, worker termination fallback time, `device.lost`, validation messages,
crashes, and stale-frame behavior. Gates are median ≤8s, p95 ≤12s, incremental
peak ≤3 GB, no renderer-attributable main-thread task >100ms, and DOM-equivalent
fallback visible within one second.

- [ ] **Step 7: Measure product preservation and visual improvement**

Run automatic alpha/bounds/changed-pixel/clipping/SSIM checks over all six seed
and eighteen catalog assets. Require bit-identical alpha and masked SSIM ≥0.92.
Review one asset per category at near/far depth, for twelve golden composites,
at both 1440x900 and 1280x800. Reject silhouette/position/scale/rotation changes,
product substitution, lost material/detail, room redesign, or grounding that
does not improve over DOM.

- [ ] **Step 8: Write the spike verdict and concrete manifest**

Create the report with exact evidence sections: environment, time used,
candidates, licenses, conversion, hashes, operator support, cold/cancel/warm/
offline/cache, requests/privacy, latency, memory, main thread, ten-revision
stability, automatic quality, golden screenshots, failures, and decision.

For `PASS`, include a complete JSON object matching:

```ts
interface SelectedModelManifest {
  id: string;
  version: string;
  runtimeVersion: "1.29.0";
  modelKind: "parametric-harmonizer" | "restricted-shadow";
  totalBytes: number;
  cacheBytes: number;
  allowedOrigins: string[];
  license: { code: string; weights: string; conversion: string };
  shards: Array<{ path: string; url: string; bytes: number; sha256: string }>;
  inputs: Array<{ name: string; shape: number[]; dtype: "float32" | "float16" }>;
  outputs: Array<{ name: string; shape: number[]; dtype: "float32" | "float16" }>;
}
```

For `FAIL`, name every failed threshold and the best next research option. Do
not include a selected manifest and do not execute Tasks 6-11.

- [ ] **Step 9: Commit the report and enforce the gate**

```bash
git add docs/superpowers/spikes/2026-09-02-nook-webgpu-renderer.md
git diff --cached --check
git commit -m "docs: report browser renderer spike"
```

If verdict is `FAIL`, stop and report. If verdict is `PASS`, verify the photo
worktree is clean, then continue.

---

### Task 6: Render Snapshot, Protocol, and Product Quality Primitives

**Condition:** Execute only when Task 5 verdict is `PASS`.

**Files:**

- Create: `src/features/photo/renderer/render-snapshot.ts`
- Create: `src/features/photo/renderer/worker-protocol.ts`
- Create: `src/features/photo/renderer/quality-gates.ts`
- Create: `src/features/photo/renderer/model-manifest.ts`
- Create: `tests/unit/render-snapshot.test.ts`
- Create: `tests/unit/renderer-worker-protocol.test.ts`
- Create: `tests/unit/renderer-quality-gates.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: approved `SelectedModelManifest`, validated Scene, asset registry/calibration versions, exact 1024x576 profile.
- Produces: `createRenderSnapshot(scene)`, `canonicalRenderJson(snapshot)`, `getRenderKey(snapshot)`, strict `RendererWorkerRequestSchema`/`RendererWorkerResponseSchema`, and `evaluateRenderQuality(input)`.

- [ ] **Step 1: Install the exact approved runtime only**

Run:

```bash
pnpm add --save-exact onnxruntime-web@1.29.0
```

Inspect `package.json` and `pnpm-lock.yaml`. Reject unrelated direct dependency
changes.

- [ ] **Step 2: Write RED snapshot/hash tests**

Require stable key ordering, lower-case 64-character SHA-256, selected/locked/
product prose exclusion, visual-field inclusion, and a revision-ABA case with
the same `sceneId/revision` but a different object asset/position producing a
different `contentHash`.

Use these public types:

```ts
export interface RenderObjectSnapshot {
  id: string;
  type: SceneObjectType;
  source: "placeholder" | "product";
  assetId: string;
  position: Vec3;
  rotationY: number;
  dimensionsM: DimensionsM;
  anchor: { x: number; y: number };
}

export interface RenderSnapshot {
  sceneId: string;
  revision: number;
  backgroundAssetId: string;
  assetRegistryVersion: 1;
  calibrationVersion: 1;
  renderProfileVersion: 1;
  output: { width: 1024; height: 576 };
  objects: RenderObjectSnapshot[];
}

export interface RenderKey {
  sceneId: string;
  revision: number;
  contentHash: string;
  modelVersion: string;
  renderProfileVersion: 1;
}

export function createRenderSnapshot(scene: Scene): RenderSnapshot;
export function canonicalRenderJson(snapshot: RenderSnapshot): string;
export async function getRenderKey(
  snapshot: RenderSnapshot,
  modelVersion: string,
): Promise<RenderKey>;
export function renderKeysEqual(a: RenderKey, b: RenderKey): boolean;
```

- [ ] **Step 3: Write RED worker protocol tests**

Define Zod-discriminated messages for `probe`, `download`, `progress`,
`verify`, `initialize`, `ready`, `render`, `result`, `cancel`, `cancelled`,
`cache-status`, `delete-cache`, and `error`. Require `jobId` and full render key
on render/result/error. Reject unknown types, extra keys, invalid hashes,
negative byte counts, progress beyond total, duplicate shard paths, and invalid
error codes.

Export the inferred directions used by later tasks:

```ts
export type RendererErrorCode =
  | "UNSUPPORTED"
  | "OFFLINE_CACHE_MISS"
  | "QUOTA_EXCEEDED"
  | "INTEGRITY_FAILED"
  | "DEVICE_LOST"
  | "OUT_OF_MEMORY"
  | "MODEL_FAILED"
  | "QUALITY_FAILED"
  | "WORKER_FAILED";

export const RendererWorkerRequestSchema = z.discriminatedUnion("type", [
  ProbeRequestSchema,
  DownloadRequestSchema,
  InitializeRequestSchema,
  RenderRequestSchema,
  CancelRequestSchema,
  CacheStatusRequestSchema,
  DeleteCacheRequestSchema,
]);
export const RendererWorkerResponseSchema = z.discriminatedUnion("type", [
  ProbeResultSchema,
  ProgressResponseSchema,
  VerifyResponseSchema,
  ReadyResponseSchema,
  RenderProgressResponseSchema,
  RenderResultResponseSchema,
  CancelledResponseSchema,
  CacheStatusResponseSchema,
  ErrorResponseSchema,
]);
export type RendererWorkerRequest = z.infer<typeof RendererWorkerRequestSchema>;
export type RendererWorkerResponse = z.infer<typeof RendererWorkerResponseSchema>;
```

- [ ] **Step 4: Write RED quality tests**

Use tiny RGBA fixtures to prove bit-identical alpha/bounds/centroid/anchor,
changed-pixel confinement, clipped-population calculation, and deterministic
masked SSIM. Require rejection below 0.92, outside-mask change, non-finite
channel, dimension mismatch, and altered alpha.

Expose:

```ts
export interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type RenderQualityResult =
  | {
      ok: true;
      metrics: { maskedSsim: number; clippedRatio: number };
    }
  | {
      ok: false;
      code:
        | "INVALID_PIXELS"
        | "DIMENSION_MISMATCH"
        | "ALPHA_CHANGED"
        | "OUTSIDE_MASK_CHANGED"
        | "SSIM_TOO_LOW"
        | "CLIPPING_TOO_HIGH";
      metrics: { maskedSsim: number; clippedRatio: number };
    };

export function evaluateRenderQuality(input: {
  source: ImageDataLike;
  output: ImageDataLike;
  contactMask: Uint8Array;
  anchor: { x: number; y: number };
}): RenderQualityResult;
```

- [ ] **Step 5: Implement the four pure modules**

Export the exact `SelectedModelManifest` interface from Task 5. Copy the
complete concrete manifest object byte-for-byte from the PASS report into
`model-manifest.ts` and validate it at module load. Implement recursive
canonical key sorting, SHA-256, strict protocol schemas, and quality metrics.
Do not import React, Zustand, Worker, Cache Storage, IndexedDB, or ONNX Runtime
in these pure modules.

- [ ] **Step 6: Verify GREEN and commit**

```bash
pnpm exec vitest run tests/unit/render-snapshot.test.ts tests/unit/renderer-worker-protocol.test.ts tests/unit/renderer-quality-gates.test.ts
pnpm run typecheck
pnpm run lint
git diff --check
git add package.json pnpm-lock.yaml src/features/photo/renderer/render-snapshot.ts src/features/photo/renderer/worker-protocol.ts src/features/photo/renderer/quality-gates.ts src/features/photo/renderer/model-manifest.ts tests/unit/render-snapshot.test.ts tests/unit/renderer-worker-protocol.test.ts tests/unit/renderer-quality-gates.test.ts
git commit -m "feat(renderer): define verified render contracts"
```

---

### Task 7: Explicit Model Download, Verified Cache, and Offline Lifecycle

**Condition:** Execute only when Task 5 verdict is `PASS`.

**Files:**

- Create: `src/features/photo/renderer/model-cache.ts`
- Create: `tests/unit/renderer-model-cache.test.ts`
- Test in browser later: `tests/e2e/hybrid-renderer.spec.ts`

**Interfaces:**

- Consumes: `SELECTED_MODEL_MANIFEST`, injected `fetch`, Cache Storage, IndexedDB metadata store, AbortSignal.
- Produces: `inspectModelCache()`, `downloadAndVerifyModel()`, `deleteModelCache()`, and `openVerifiedModel()`.

- [ ] **Step 1: Write RED cache state-machine tests**

Use injected in-memory cache and metadata adapters. Cover no request before
`downloadAndVerifyModel`, real received/total byte progress, credentialless/no-
referrer requests, sequential ≤64MiB shard verification, abort cleanup, hash
mismatch cleanup, quota cleanup, atomic ready marker, warm open with zero
fetches, incomplete offline fallback, complete offline success, version
isolation, and delete removing consent plus shards.

Public contract:

```ts
export interface RendererCacheMetadata {
  modelKey: string;
  manifestHash: string;
  consented: boolean;
  complete: boolean;
  verifiedBytes: number;
  lastAccessedAt: number;
}

export interface RendererMetadataStore {
  read(modelKey: string): Promise<RendererCacheMetadata | null>;
  write(metadata: RendererCacheMetadata): Promise<void>;
  delete(modelKey: string): Promise<void>;
}

export interface VerifiedModelHandle {
  manifest: SelectedModelManifest;
  cacheName: string;
  openedAt: number;
}

export type RendererCacheInspection =
  | { state: "missing" }
  | { state: "incomplete"; verifiedBytes: number }
  | { state: "ready"; metadata: RendererCacheMetadata };

export interface ModelDownloadProgress {
  phase: "downloading" | "verifying";
  receivedBytes: number;
  totalBytes: number | null;
  shardPath: string;
}

export async function downloadAndVerifyModel(options: {
  manifest: SelectedModelManifest;
  signal: AbortSignal;
  onProgress(progress: ModelDownloadProgress): void;
  fetchImpl?: typeof fetch;
  cacheStorage?: CacheStorage;
  metadataStore?: RendererMetadataStore;
}): Promise<VerifiedModelHandle>;

export function inspectModelCache(options: {
  manifest: SelectedModelManifest;
  cacheStorage?: CacheStorage;
  metadataStore?: RendererMetadataStore;
}): Promise<RendererCacheInspection>;

export function openVerifiedModel(options: {
  manifest: SelectedModelManifest;
  cacheStorage?: CacheStorage;
  metadataStore?: RendererMetadataStore;
}): Promise<VerifiedModelHandle | null>;

export function deleteModelCache(options: {
  manifest: SelectedModelManifest;
  terminateSession(): void;
  cacheStorage?: CacheStorage;
  metadataStore?: RendererMetadataStore;
}): Promise<void>;
```

- [ ] **Step 2: Run cache tests and record RED**

```bash
pnpm exec vitest run tests/unit/renderer-model-cache.test.ts
```

Expected: module and lifecycle functions do not exist.

- [ ] **Step 3: Implement per-shard download and integrity**

Reject unlisted origins and redirects outside the manifest allowlist. Use
`credentials: "omit"`, `referrerPolicy: "no-referrer"`, and `cache: "no-store"`.
Read at most one ≤64MiB shard into memory for SHA-256, store its verified
response, release the buffer, then continue. Write the IndexedDB complete marker
only after all shards verify. On abort/error, delete the version cache and
incomplete metadata.

- [ ] **Step 4: Implement native IndexedDB metadata and cache deletion**

Store only manifest identity, hashes, byte counts, consent, completeness, and
last access. Do not store Scene, images, prompts, products, results, or tokens.
Close database transactions deterministically. `deleteModelCache` terminates
the supplied session callback before deleting Cache Storage and metadata.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm exec vitest run tests/unit/renderer-model-cache.test.ts tests/unit/renderer-worker-protocol.test.ts
pnpm run typecheck
pnpm run lint
git diff --check
git add src/features/photo/renderer/model-cache.ts tests/unit/renderer-model-cache.test.ts
git commit -m "feat(renderer): cache verified model shards"
```

---

### Task 8: Successful-Command Receipts and Latest-Wins Controller

**Condition:** Execute only when Task 5 verdict is `PASS`.

**Files:**

- Modify: `src/features/scene/scene-store.ts`
- Modify: `src/features/scene/scene-context.tsx`
- Create: `src/features/photo/renderer/renderer-controller.ts`
- Create: `tests/unit/renderer-controller.test.ts`
- Modify: `tests/unit/scene-store.test.ts`
- Modify: `tests/unit/webmcp-tools.test.ts`

**Interfaces:**

- Consumes: successful `CommandResult`, command type, immutable committed Scene, typed worker port.
- Produces: `SceneStoreOptions.onRenderEligibleCommit`, `RenderCommitReceipt`, and `RendererController` with subscribe/enable/disable/schedule/cancel/retry/delete-cache/dispose.

- [ ] **Step 1: Write RED store receipt tests**

Define:

```ts
export interface RenderCommitReceipt {
  commandType: "replace" | "move";
  scene: Scene;
}

export interface SceneStoreOptions {
  onRenderEligibleCommit?(receipt: RenderCommitReceipt): void;
  onRenderObserverError?(error: unknown): void;
}
```

Test one receipt after the successful Scene has been installed for human move,
human replace, WebMCP move, and WebMCP replace. Test zero receipts for selection,
pointer preview, stale, locked, category mismatch, missing object/selection,
undo, reset, cart, and clipboard. Make observer throw and prove the already-
successful command result/Scene/history/revision/stateVersion remain unchanged.

- [ ] **Step 2: Write RED controller tests with a fake worker**

Use these exact public boundaries:

```ts
export type RendererPhase =
  | "unsupported"
  | "not-downloaded"
  | "downloaded"
  | "downloading"
  | "verifying"
  | "initializing"
  | "ready"
  | "rendering"
  | "enhanced"
  | "failed"
  | "cancelled";

export interface RendererControllerSnapshot {
  phase: RendererPhase;
  progress: ModelDownloadProgress | null;
  acceptedKey: RenderKey | null;
  acceptedBitmap: ImageBitmap | null;
  errorCode: RendererErrorCode | null;
  retryBlocked: boolean;
  offline: boolean;
}

export interface RendererWorkerPort {
  post(message: RendererWorkerRequest): void;
  subscribe(listener: (message: RendererWorkerResponse) => void): () => void;
  terminate(): void;
}

export interface RendererController {
  getSnapshot(): RendererControllerSnapshot;
  subscribe(listener: () => void): () => void;
  enable(): Promise<void>;
  schedule(receipt: RenderCommitReceipt): void;
  cancel(): void;
  retry(): Promise<void>;
  deleteCache(): Promise<void>;
  disable(): void;
  dispose(): void;
}
```

Create `FakeRendererWorkerPort` with explicit `emit(message)` and sent-message
history. Assert no worker/download before enable; version-specific consent;
latest-wins scheduling; out-of-order result disposal; mismatch on each key
field; duplicate result disposal; render failure restoring DOM; user cancel
terminating the worker; two fatal failures opening the retry circuit; retry
requiring user action; and dispose closing every bitmap/listener.

- [ ] **Step 3: Run tests and record RED**

```bash
pnpm exec vitest run tests/unit/scene-store.test.ts tests/unit/webmcp-tools.test.ts tests/unit/renderer-controller.test.ts
```

- [ ] **Step 4: Implement isolated post-success receipts**

Change `createSceneStore(seed = createDemoScene(), options = {})`. Invoke the
observer only after `set` completes and only for successful replace/move.
Provide a cloned validated Scene. Catch observer exceptions and report them to
an injected diagnostic callback or `console.error`; never change the command
return or retry a mutation.

- [ ] **Step 5: Implement controller lifecycle**

Keep renderer state outside Scene/Zustand. On a receipt, asynchronously derive
the snapshot/hash, coalesce queued jobs to the latest key, and submit only while
enabled/ready. Before accepting a result, call an injected `getCurrentScene()`
and recompute its key. Close mismatched bitmaps. An in-flight uninterruptible
run may finish but never display stale output.

- [ ] **Step 6: Verify GREEN and commit**

```bash
pnpm exec vitest run tests/unit/scene-store.test.ts tests/unit/webmcp-tools.test.ts tests/unit/renderer-controller.test.ts
pnpm run typecheck
pnpm run lint
git diff --check
git add src/features/scene/scene-store.ts src/features/scene/scene-context.tsx src/features/photo/renderer/renderer-controller.ts tests/unit/scene-store.test.ts tests/unit/webmcp-tools.test.ts tests/unit/renderer-controller.test.ts
git commit -m "feat(renderer): schedule successful scene commits"
```

---

### Task 9: Dedicated WebGPU Worker and Geometry-Locked Harmonization

**Condition:** Execute only when Task 5 verdict is `PASS`.

**Files:**

- Create: `src/features/photo/renderer/renderer-worker.ts`
- Create: `src/features/photo/renderer/renderer-worker-client.ts`
- Create: `tests/unit/renderer-worker-client.test.ts`
- Modify: `src/features/photo/renderer/quality-gates.ts`

**Interfaces:**

- Consumes: verified shard responses, render snapshot, registered images/anchors/projection, approved model inputs/outputs.
- Produces: dedicated module worker, `RendererWorkerClient`, transferable accepted `ImageBitmap`, typed progress/errors.

- [ ] **Step 1: Read the installed worker-bundling guides**

Run:

```bash
sed -n '150,205p' node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md
sed -n '110,150p' node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md
```

Use the installed `new Worker(new URL(..., import.meta.url), { type: "module" })`
support. Verify both vinext and the required Next webpack build rather than
assuming the two bundlers emit identical worker chunks.

- [ ] **Step 2: Write RED client/worker-boundary tests**

Mock the native Worker constructor and assert exact module URL/type, strict
message parsing, one job per request, transferable bitmap ownership, cancel
acknowledgement, terminate cleanup, malformed/duplicate message rejection, and
no ORT import in the main-thread client bundle.

- [ ] **Step 3: Run tests and record RED**

```bash
pnpm exec vitest run tests/unit/renderer-worker-client.test.ts tests/unit/renderer-quality-gates.test.ts
```

- [ ] **Step 4: Implement worker capability and session phases**

Inside the worker only, import `onnxruntime-web/webgpu`, probe Worker,
OffscreenCanvas, WebGPU adapter/device, required limits, and the bundled tiny
session. Load the approved external-data shards from verified Cache Storage and
create the session with `executionProviders: ["webgpu"]`. Map adapter missing,
device lost, session creation, OOM, and unsupported operator errors to exact
protocol codes.

- [ ] **Step 5: Implement deterministic composition and bounded model output**

Decode the same registered background/cutouts, apply exact anchor-aware 16:9
projection/layer order, build composite/foreground/contact masks, run the
approved model, clamp its parametric RGB/gain outputs, copy original alpha, and
apply shadow only inside the bounded contact mask. Run `evaluateRenderQuality`
before transferring a result. Never transfer or display a failed candidate.

- [ ] **Step 6: Implement resource cleanup and latest-job handling**

Close decoded and output `ImageBitmap`s, tensors, GPU buffers exposed by ORT,
canvases, and sessions when superseded/disposed. Check stale/cancel flags before
and after every phase and between model iterations where supported. A fatal
cancel terminates the worker through the client.

- [ ] **Step 7: Verify GREEN and commit**

```bash
pnpm exec vitest run tests/unit/renderer-worker-client.test.ts tests/unit/renderer-worker-protocol.test.ts tests/unit/renderer-quality-gates.test.ts
pnpm run typecheck
pnpm run lint
pnpm run build
git diff --check
git add src/features/photo/renderer/renderer-worker.ts src/features/photo/renderer/renderer-worker-client.ts src/features/photo/renderer/quality-gates.ts tests/unit/renderer-worker-client.test.ts
git commit -m "feat(renderer): run geometry-locked WebGPU harmonization"
```

---

### Task 10: Renderer Runtime, Raster Layer, Consent UI, and DOM Hit Layer

**Condition:** Execute only when Task 5 verdict is `PASS`.

**Files:**

- Create: `src/features/photo/renderer/renderer-context.tsx`
- Create: `src/features/photo/renderer/hybrid-render-layer.tsx`
- Create: `src/features/photo/renderer/enhanced-rendering-status.tsx`
- Modify: `src/features/demo/demo-workspace.tsx`
- Modify: `src/features/demo/room-canvas.tsx`
- Modify: `src/features/photo/room-photo-stage.tsx`
- Modify: `src/features/photo/photo-object-layer.tsx`
- Modify: `src/features/demo/demo-workspace.module.css`
- Create: `tests/unit/hybrid-renderer-ui.test.tsx`
- Modify: `tests/unit/demo-workspace.test.tsx`
- Modify: `tests/unit/room-photo-stage.test.tsx`

**Interfaces:**

- Consumes: controller snapshot, accepted bitmap/key, current Scene key, existing stage controls.
- Produces: `RendererProvider`, `useRenderer()`, raster canvas, exact visible/live lifecycle UI, DOM visual/hit switching.

- [ ] **Step 1: Write RED UI lifecycle tests with fake controller**

Cover unsupported reason, not-downloaded consent, byte and percentage progress,
unknown-total byte progress, cancel, verifying, initializing, downloaded-but-
inactive, ready offline, rendering, enhanced revision, integrity/quota/OOM/
device/quality failures, retry circuit, and cache delete. Every state must be
visible and present in a polite live region.

- [ ] **Step 2: Write RED DOM/raster layering tests**

Inject an accepted fake bitmap/key. Assert the raster canvas is visible, object
buttons remain labelled/focusable/selectable, cutout images have transparent
visual class, and focus/anchor/handle remain visible. Trigger pointer-down,
keyboard move, undo, reset, key mismatch, and renderer failure; each must hide
raster and reveal all DOM cutout pixels synchronously.

- [ ] **Step 3: Run tests and record RED**

```bash
pnpm exec vitest run tests/unit/hybrid-renderer-ui.test.tsx tests/unit/demo-workspace.test.tsx tests/unit/room-photo-stage.test.tsx
```

- [ ] **Step 4: Compose one demo runtime without a second Scene**

Create the controller and Scene store once in `DemoWorkspace` initialization.
Pass `onRenderEligibleCommit` into `createSceneStore`, then bind the controller's
`getCurrentScene` to that store. Provide the controller through a separate
renderer context. Do not add renderer fields to Scene, history, or
`SceneStoreState`; do not change `ToolContext` or Core 6 registration.

- [ ] **Step 5: Implement accepted raster drawing and ownership**

Draw each accepted 1024x576 bitmap into the stage canvas once, then close the
transferred bitmap after the canvas owns the pixels. Store only the exact
accepted key and canvas generation. Hide the canvas whenever the current key
does not match or direct manipulation begins.

- [ ] **Step 6: Implement consent/cache/fallback UI and DOM hit mode**

Use exact copy/states from the spec. Never start download or GPU initialization
on mount. A warm-cache page shows `Downloaded`; the user activates it for that
document. When raster is exact, add a class that hides only the `<img>`/fallback
pixels, not the outer button, focus ring, floor marker, locked badge, or rotate
handle. Preserve responsive layout at 1440x900 and 1280x800.

- [ ] **Step 7: Verify GREEN and commit**

```bash
pnpm exec vitest run tests/unit/hybrid-renderer-ui.test.tsx tests/unit/demo-workspace.test.tsx tests/unit/room-photo-stage.test.tsx tests/unit/register-tools.test.tsx tests/unit/webmcp-tools.test.ts
pnpm run typecheck
pnpm run lint
pnpm run build
git diff --check
git add src/features/photo/renderer/renderer-context.tsx src/features/photo/renderer/hybrid-render-layer.tsx src/features/photo/renderer/enhanced-rendering-status.tsx src/features/demo/demo-workspace.tsx src/features/demo/room-canvas.tsx src/features/photo/room-photo-stage.tsx src/features/photo/photo-object-layer.tsx src/features/demo/demo-workspace.module.css tests/unit/hybrid-renderer-ui.test.tsx tests/unit/demo-workspace.test.tsx tests/unit/room-photo-stage.test.tsx
git commit -m "feat(renderer): add optional enhanced room rendering"
```

---

### Task 11: Browser Lifecycle, Privacy, Real Smoke, Full Matrix, and Handoff

**Condition:** Execute only when Task 5 verdict is `PASS` and Tasks 6-10 are green.

**Files:**

- Create: `tests/e2e/hybrid-renderer.spec.ts`
- Modify: `tests/e2e/photo-compositor.spec.ts`
- Modify: `tests/e2e/webmcp-core.spec.ts`
- Modify: `README.md`
- Modify: `docs/NEXT_SESSION.md`
- Create local ignored evidence: `output/playwright/hybrid-renderer-final/*.png`

**Interfaces:**

- Consumes: complete controller/cache/worker/UI, fake worker browser injection, passing real spike configuration.
- Produces: deterministic browser regressions, repeated real WebGPU evidence, full verification, final unmerged branch report.

- [ ] **Step 1: Add a deterministic fake-worker E2E journey**

Inject a protocol-compatible fake before page load. Assert consent-before-
download, progress/cancel, warm/offline/cache-delete states, only successful
replace/move scheduling, no schedules for stale/locked/mismatch/no-selection,
latest revision winning out-of-order delivery, bad hash/scene/revision rejection,
DOM preview during drag, transparent accessible hit layer after acceptance,
undo/reset fallback, worker failure recovery, two-failure retry circuit, exact
Core 6 names, and registration cleanup.

- [ ] **Step 2: Add complete privacy and cart request assertions**

Before consent, require zero model requests. During cold consent, permit only
manifest-listed credentialless GETs. After warm cache and throughout ten
renders, require zero model-network requests. Around cart approval, reject any
non-safe method, cart/checkout path, beacon, form, XHR/fetch mutation, or
unlisted cross-origin request. Assert room/Scene/prompt/product JSON never
appears in request URL, headers, or body.

- [ ] **Step 3: Run focused fake-worker browser tests**

```bash
pnpm exec playwright test tests/e2e/hybrid-renderer.spec.ts tests/e2e/photo-compositor.spec.ts tests/e2e/photo-assets.spec.ts tests/e2e/webmcp-core.spec.ts tests/e2e/demo-workspace.spec.ts --config=playwright.config.ts
```

- [ ] **Step 4: Repeat the real WebGPU smoke on product code**

Use the same reference browser/GPU and Section 15 thresholds from the spec.
Record cold/cancel/warm/offline/delete, ten renders, median/p95, incremental
memory, main-thread long tasks, console, request log, quality metrics, and no
stale flash. Save seed and redesigned screenshots at 1440x900 and 1280x800
under `output/playwright/hybrid-renderer-final/`. A regression from the spike
blocks completion and must be fixed or reported; it is not waived by fake E2E.

- [ ] **Step 5: Update truthful documentation**

Document frontend-only local inference, explicit 1-2 GB-class download consent,
actual selected model/version/bytes/license, cache delete, warm/offline behavior,
unsupported fallback, geometry/product preservation, Core 6 non-change,
privacy/network evidence, exact commands, and the fact that local MCP remains
unimplemented. Update `docs/NEXT_SESSION.md` with exact counts and commit
subjects without self-referencing the final documentation commit SHA.

- [ ] **Step 6: Run the final complete matrix**

Run in this exact order and stop on first failure:

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

- [ ] **Step 7: Run final code, visual, and invariant review**

Review `main...HEAD` for product correctness, worker/cache cleanup, model
license/hash accuracy, memory copies, stale results, state/tool boundary drift,
accessibility, privacy, and test gaps. Confirm exact Core 6, zero external cart
write, Scene/revision/stateVersion/undo/selection invariants, and clean fallback.

- [ ] **Step 8: Commit final journey and docs**

```bash
git add tests/e2e/hybrid-renderer.spec.ts tests/e2e/photo-compositor.spec.ts tests/e2e/webmcp-core.spec.ts README.md docs/NEXT_SESSION.md
git diff --cached --check
git commit -m "test(renderer): verify local WebGPU lifecycle"
git status --short
git log --oneline --decorate -15
git diff main...HEAD --stat
```

Expected: clean unmerged `feat/photo-compositor`; all gates green; no pushed
branch, pull request, deployment, external cart write, model API call, room
upload, or local MCP companion implementation.
