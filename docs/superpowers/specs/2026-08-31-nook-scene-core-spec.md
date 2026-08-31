# Nook Deterministic Scene Core Specification

## Outcome

Replace the static `/demo` room approximation with a real, editable React Three Fiber scene whose JSON state is the source of truth. Human UI actions must mutate that state through the same revision-aware command layer that WebMCP tools will consume in the next work package.

## Scope

This work package includes:

- deterministic living-room generation from validated semantic analysis;
- Zod-validated Scene JSON measured in meters;
- revision-aware replace, move, preserve, and style commands;
- a Zustand vanilla store with selection, tool mode, a 30-entry history, undo, and canonical reset;
- a real React Three Fiber room with primitive furniture placeholders;
- object selection, Move/Rotate tool activation, TransformControls commit-on-release, product preview replacement, Agent lamp move, undo, and reset;
- deterministic fixtures only, with no network or external commerce write.

Shopify, Tripo, WebMCP registration, upload analysis, persistence, R2, and D1 are outside this package.

## Scene Contract

- Coordinates and dimensions use meters.
- The room origin is at the floor centre. Positive X points right, positive Y points up, and negative Z points toward the back wall.
- Supported categories are `sofa`, `coffee_table`, `rug`, `floor_lamp`, `chair`, `plant`, and `unknown`.
- Furniture positions represent object centres. Every generated or replaced object rests on the floor; rugs use `y = 0.01`.
- Scene revision starts at `1`. Every successful design/spatial command increments it once. Selection and tool-mode changes are revision-neutral.
- A command with a stale `expectedRevision` returns `SCENE_REVISION_CONFLICT` and does not mutate state.
- Locked objects reject replace and move with `OBJECT_LOCKED`.
- Replacement requires matching categories, preserves X/Z and rotation, updates commerce metadata/dimensions, and normalizes Y so the new object remains on the floor.
- Move commands clamp the object inside the room with a `0.1m` inset and report `adjustedToFit` when requested coordinates were changed.
- Reset deep-clones the canonical seed and restores revision `1`, selection `table_01`, history, tool mode, and transient transform state.

## Room Engine Contract

- User-confirmed width is clamped to `2.5..8.0m`.
- Depth is `width / estimatedAspectRatio`, clamped to `2.5..8.0m`.
- Height is `2.5m`.
- Analysis objects below confidence `0.55` are omitted.
- Semantic anchors map deterministically into room-local coordinates.
- Objects are normalized within the room boundary.
- The initial sofa and coffee table must not overlap after AABB normalization.

## Store Contract

`createSceneStore(seed)` produces a Zustand vanilla store. Its public actions are:

```ts
selectObject(objectId: string | null): void;
setToolMode(mode: "select" | "move" | "rotate"): void;
applyCommand(request: CommandRequest): CommandResult;
commitTransform(objectId: string, position: Vec3, rotationY?: number): CommandResult;
undo(): boolean;
reset(): void;
setTransforming(isTransforming: boolean): void;
```

Successful commands push the previous Scene onto history, capped at 30. One transform gesture produces one history entry when released; preview frames never write to the store.

## Renderer Contract

- The existing 64px header, 72px tool rail, 360px context panel, and 72px composer remain intact at `1280 × 720`.
- The room viewport is a real `<canvas>` rendered by React Three Fiber, not the approved static room image.
- Room geometry includes a floor, back wall, left wall, ambient light, directional light, and a perspective camera.
- Category primitives remain distinguishable by silhouette and accessible through the existing object list.
- Clicking a mesh selects it. Escape clears selection.
- Move uses X/Z translation; Rotate uses Y rotation.
- Orbit controls are disabled while TransformControls are dragging.
- Replacement is visible within one second and preserves the selected object's spatial placement.
- Reduced-motion mode removes replacement animation.
- The object list and inspector remain fully usable if WebGL is unavailable.

## Verification

- Unit tests cover schema validation, room generation, boundary clamping, replacement, lock rejection, revision conflict, history cap, undo, reset, and transform commit.
- Component tests cover store-backed selection, tool activation, product replacement, Agent move, undo, and reset.
- Playwright at `1280 × 720` verifies a canvas is present and the deterministic product/Agent/cart journey still completes without console errors.
- `pnpm run test`, `pnpm run test:e2e`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `pnpm run build:next` exit `0`.
