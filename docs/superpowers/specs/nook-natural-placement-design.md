# Nook Natural Placement Design

**Date:** 2026-09-02

**Status:** Approved on 2026-09-02 after in-chat architectural review and
written-spec review.

**Depends on:** The repaired static photo compositor on
`feat/photo-compositor`. Its focused tests, complete verification matrix,
1440x900 and 1280x800 visual review, and independent re-review must pass before
the existing WebGPU spike may begin.

**Related specifications:**

- `2026-09-01-nook-photo-compositor-design.md` remains the governing static
  compositor and Core 6 contract.
- `nook-hybrid-image-renderer-design.md` remains the governing optional image
  harmonizer contract.
- This document adds deterministic Scene placement and projection behavior. It
  does not authorize a model to move or reshape products.

## 1. Outcome

Nook produces a coherent furniture arrangement when the first catalog redesign
is completed and when a person later chooses **Arrange naturally**. Placement is
computed from room-space metres, product dimensions, openings, locks, and
category relationships. The resulting positions and rotations are committed to
the existing canonical Scene through the command layer.

The DOM compositor also renders furniture with more credible grounding:

- rugs lie on the calibrated floor plane;
- product size differences remain visible after perspective scaling;
- non-rug objects stack by their floor contact point; and
- deterministic contact shadows connect vertical cutouts to the floor.

This feature is local, deterministic, synchronous, and model-free. The optional
hybrid image renderer may later harmonize the committed composition, but it does
not participate in placement.

## 2. Governing Invariants

The implementation must preserve all existing product boundaries:

- Validated Scene JSON in Zustand is the only canonical object state.
- Committed placement changes pass through the Scene command layer. DOM and CSS
  do not keep a second persisted position model.
- The WebMCP surface remains exactly the Core 6: `get_scene`, `get_selection`,
  `search_products`, `replace_object`, `move_object`, and
  `add_scene_to_cart`.
- No public arrange, batch, execute, render, image, or model tool is added.
- Existing stale-revision, lock, category, missing-object, missing-selection,
  validation, and structured-error behavior remains intact.
- Selection, tool mode, pointer and keyboard transforms, reset, registration
  cleanup, and approval-only cart behavior remain intact.
- `add_scene_to_cart` still opens only the local approval sheet and performs no
  external request.
- A manual natural arrangement is one atomic command-layer mutation, one Scene
  revision, one `stateVersion` increment, and one history entry.
- Locked objects never move. They remain selectable and act as fixed obstacles.
- A manual no-op or failed arrangement changes no Scene, revision,
  `stateVersion`, history, or renderer scheduling state. An automatic no-op or
  failure still permits the successful replacement itself to commit and
  schedule under the existing `replace` rule.
- The image harmonizer cannot move an object, alter a silhouette, choose a
  layout, or make derived raster pixels canonical.
- There is no server, API key, photo upload, Scene upload, or runtime asset
  download in this feature.

## 3. Non-goals

- Inferring arbitrary room geometry from a newly uploaded photograph.
- Supporting object categories beyond the existing sofa, coffee table, rug,
  floor lamp, chair, and plant.
- Producing a physically certified interior plan or accessibility guarantee.
- Inventing furniture, changing product imagery, synthesizing unseen views, or
  making a single-view cutout appear to rotate in 3D.
- Exposing the placement solver to agents or the local MCP companion.
- Replacing direct manipulation or preventing a user from adjusting the result.
- Optimizing large arbitrary inventories. The solver is bounded to the current
  small room Scene.

## 4. User Experience and Triggers

### 4.1 First completed redesign

Automatic natural placement occurs only on the transition caused by a
successful `replace_object` where:

1. the command actor is `agent`;
2. the pre-command Scene contains at least one unlocked placeholder;
3. the post-replacement Scene contains no unlocked placeholders; and
4. the Scene contains at least one unlocked product.

Locked placeholders do not prevent completion and do not move. Intermediate
replacements do not arrange the room. Undo and reset never trigger placement.
If undo restores an unlocked placeholder and a later successful replacement
completes the redesign again, the transition is eligible again.

The final replacement and eligible automatic arrangement are validated and
installed as one canonical replace result. They share one revision and one
history snapshot, so the tool response cannot race a hidden later revision. The
store's post-commit observer receives only the final committed Scene and may
schedule the optional renderer exactly once with cause `replace`.

If no valid improvement exists or the solver fails, the replacement still
succeeds at the requested object and preserves all existing positions. A short
status explains that placement was retained. Human product preview does not
auto-arrange even when it replaces the last placeholder. There is no partial
arrangement.

### 4.2 Explicit human request

The canvas top bar gains an **Arrange naturally** button. It is a normal Human
UI control, not a WebMCP tool. It is keyboard accessible and disabled while a
pointer or rotation transform is active or when there are no unlocked objects.

An eligible click evaluates every unlocked object, including objects moved by a
person before the click. Locked objects remain fixed. A changed result:

- preserves the selected object and tool mode;
- commits as one atomic internal move batch;
- increments `revision` and `stateVersion` once;
- appends one pre-command Scene to history;
- displays `Placement improved` in the existing status/undo surface; and
- is fully restored by one Undo.

The renderer observer classifies the atomic batch as one successful `move`
revision and schedules at most one render. A no-op displays
`Current placement is already the safest option` and schedules nothing.

### 4.3 Direct manipulation

Existing pointer, keyboard, selection, focus, floor-anchor, and rotation-handle
behavior remains available before and after arrangement. Natural placement does
not run after an individual human move or rotation. It does not repeatedly
"correct" a person's choices.

The solver does not rotate vertical single-view cutouts. It preserves their
current Scene Y rotation and moves them spatially. Rugs may receive a floor-plane
Y rotation because their registered source quadrilateral can be projected
without inventing an unseen vertical view.

## 5. Architecture and Ownership

### 5.1 Pure placement module

A focused `natural-placement` domain module owns candidate generation, hard
constraints, scoring, deterministic tie-breaking, and diagnostics. Its module
contract is:

```ts
type NaturalPlacementResult =
  | {
      kind: "changed";
      placements: ReadonlyArray<{
        objectId: string;
        position: Vec3;
        rotationY: number;
      }>;
      diagnostics: PlacementDiagnostics;
    }
  | {
      kind: "unchanged";
      reason: "already-safe" | "no-safe-improvement";
      diagnostics: PlacementDiagnostics;
    }
  | { kind: "failed"; reason: PlacementFailureReason };

interface PlacementDiagnostics {
  currentScore: number | null;
  proposedScore: number | null;
  evaluatedLayouts: number;
}

type PlacementFailureReason =
  | "invalid-input"
  | "no-valid-layout"
  | "search-limit-exhausted"
  | "unexpected";

function proposeNaturalPlacement(scene: Scene): NaturalPlacementResult;
```

The function never mutates its input, reads the DOM, calls Zustand, uses random
numbers, reads wall-clock time, or schedules rendering. It returns proposals,
not a Scene.

### 5.2 Command boundary

The command layer owns all mutation and revalidation. It accepts the current
validated Scene plus the complete proposal, verifies object identity, locks,
finite coordinates, room bounds, footprint collisions, and Scene schema, then
either commits the entire proposal or rejects all of it.

The internal atomic move batch is not added to the public `SceneCommand` JSON
contract or WebMCP manifest. It is exposed only through a typed store method used
by the Human UI and by the final-replacement orchestration. Public
`move_object` remains a one-object command with its existing request and result.

For a manual arrangement, the store records one previous Scene, installs one
validated next Scene, and emits one post-commit event with cause `move`. For the
completion transition, `replace` creates its normal next Scene, the pure solver
proposes against that next Scene, and command-layer validation folds an accepted
proposal into the same next Scene before the single revision increment.

The internal command result carries a typed `placementOutcome` discriminator so
the store can publish the correct local notice. The WebMCP handler ignores this
internal metadata and continues to return its existing strict tool-result shape.

### 5.3 UI adapter

`RoomCanvas` owns the button and sighted status. It calls the store method but
does not calculate geometry. Existing live regions and undo presentation are
reused so success, no-op, and failure do not shift the stage or composer layout.
The UI adapter does not invoke any Core 6 handler.

The store exposes a noncanonical `placementNotice` event with a monotonically
increasing local event ID and one of these exact messages:

- `Redesign arranged` after an accepted completion-transition arrangement;
- `Redesign updated; placement retained` after its no-op or failure;
- `Placement improved` after an accepted explicit arrangement;
- `Current placement is already the safest option` after an explicit no-op; or
- `Could not improve placement; the room was left unchanged` after an explicit
  failure.

The notice is UI-only: it is excluded from Scene JSON, history, `stateVersion`,
tool results, render snapshots, and content hashes. Reset and undo clear it.

### 5.4 Projection profiles

`photo-projection` remains the sole room-to-stage geometry module. Category
presentation rules and optional rug source quadrilaterals are versioned inputs
to projection. `PhotoObjectLayer` consumes computed placement, rug transform,
layer order, and shadow geometry; it does not recreate those calculations.

The optional hybrid renderer includes the same projection/profile version in
its `RenderSnapshot` and content hash, so its deterministic base composite
cannot silently use older geometry.

## 6. Deterministic Placement Solver

### 6.1 Inputs and footprints

The solver uses only validated Scene fields: room dimensions, wall openings,
object type, position, Y rotation, physical dimensions, lock state, and object
ID. Product prose, price, asset pixels, selection, actor, and browser viewport
do not affect placement.

Every non-rug object has an oriented rectangular floor footprint derived from
`dimensionsM.width`, `dimensionsM.depth`, and Scene Y rotation. Candidate
overlap uses a separating-axis test. A locked rug remains a fixed seating zone;
an unlocked rug is a movable underlay and may overlap furniture by design.

The current demo's six known categories are the complete movable category set.
A locked `unknown` object remains a fixed obstacle. An unlocked `unknown`
object makes the request fail without mutation because the solver has no safe
relationship profile for it.

All accepted centers retain the existing 0.1m room inset. The command layer
performs the final bounds check even when the solver has already checked it.

### 6.2 Candidate generation

The bounded solver uses template-seeded search rather than a room-wide random or
pixel grid:

1. Preserve locked objects as fixed obstacles.
2. Generate sofa candidates near its current wall affinity and the other
   usable walls, with 0.1m along-wall offsets.
3. Generate table and rug candidates relative to each viable sofa candidate.
4. Generate chair candidates that complete a seating group without blocking
   the sofa/table clearance.
5. Generate floor-lamp and plant candidates in remaining perimeter zones.
6. Include each object's current placement as a candidate so an already good
   layout can win without churn.

Candidate arrays have stable category and coordinate ordering. A bounded beam
keeps the best 32 partial layouts at each step. No more than 48 candidates are
evaluated for one object. The supported six-object Scene therefore completes
on the main thread without a worker; the performance acceptance target is under
16ms at p95 in a production build on the project's reference browser.

### 6.3 Hard constraints

A candidate layout is invalid when any of these conditions holds:

- a non-rug footprint crosses the room inset;
- an unlocked non-rug footprint intersects another non-rug footprint;
- an unlocked footprint intersects a locked non-rug footprint;
- a floor lamp or plant is placed inside the primary seating footprint;
- furniture blocks the usable interior clearance immediately in front of a
  door or window opening; or
- no 0.75m circulation path exists from the calibrated foreground entry zone
  to the opening access zone.

The circulation check uses a deterministic 0.1m occupancy grid. Non-rug
furniture is expanded by 0.375m, rugs remain traversable, and a fixed-neighbor
flood fill checks reachability. The demo has no explicit front door, so its
entry zone is the front-wall center segment. Opening centers come from wall and
normalized offset. If locked objects make every path impossible, the solver
returns unchanged or failed rather than moving a locked object or relaxing the
clearance silently.

An opening clearance zone spans the opening width plus 0.2m on each side and
extends 0.75m into the room. The primary seating footprint is the convex hull of
the sofa, coffee-table, and chair footprints. When one of those categories is
absent, it is the hull of the remaining members; with one member it is that
member's footprint. Lamp and plant centers must remain outside that footprint.

### 6.4 Soft scoring

Valid layouts receive an integer score from 0 to 10,000. Each term is normalized
to `[0, 1]`, quantized before weighting, and contributes at most the stated
amount:

1. Circulation clearance above the hard minimum: 2,500.
2. Sofa wall proximity and viable side-of-room affinity: 1,700.
3. Coffee-table centering and 0.35-0.55m sofa edge gap: 1,800.
4. Rug centering, table containment, and 0-0.20m sofa-front relation: 1,600.
5. Chair membership in the conversation area and table clearance: 1,000.
6. Lamp and plant use of available perimeter gaps: 800.
7. Minimal total movement and minimal rug rotation: 600.

Scores are calculated from quantized millimetres to avoid browser-dependent
floating-point tie behavior. Exact ties resolve by the stable candidate index
sequence and then object ID. A given valid Scene and placement-profile version
must yield byte-equivalent placements across repeated calls.

### 6.5 Improvement and no-op rule

The current layout is scored with the same system. An arrangement commits only
when the proposed valid score exceeds the current valid score by at least 100
points, or when the current layout violates a hard constraint and the proposal
does not. This one-percent threshold prevents the button from causing minor
oscillation. A second request against the committed Scene must be a no-op.

## 7. Photo Projection and Grounding

### 7.1 Single depth scale

`projectRoomPoint` computes one calibrated depth scale. Vertical-object visual
width is the product's physical width times a category pixels-per-metre profile
and that depth scale exactly once. CSS receives the resolved percentage and
must not multiply it by depth again.

Category bounds remain only as extreme safety limits. They must preserve the
expected relative ordering in the six-product redesign: the rug footprint is
wider than the sofa, the sofa is wider than the coffee table, and the table is
wider than narrow accessories when their registered physical dimensions imply
that order. A bound may prevent stage overflow but cannot collapse ordinary
catalog products to the same apparent width.

### 7.2 Rug floor projection

Each rug asset gains an optional registered `floorQuad` containing the four
normalized corners of the visible rug plane in source-image coordinates. The
registry and asset audit require this field for every seed and catalog rug and
verify finite, in-range, clockwise, non-self-intersecting points.

The exact order is source back-left, back-right, front-right, front-left as seen
on the floor plane. Destination corners use the matching canonical room-space
order after applying Scene Y rotation.

For a rug Scene object, projection:

1. builds its physical width/depth rectangle around `(x, z)`;
2. rotates that rectangle by Scene Y rotation;
3. projects all four room points through the calibrated floor trapezoid; and
4. solves one deterministic projective transform from registered `floorQuad`
   to the projected destination quadrilateral.

The transform moves existing source pixels; it does not synthesize texture,
change alpha content, or ask a model to reshape the rug. The rug visual,
transparent hit layer, focus outline, and floor marker share the same computed
geometry. Rugs render in an underlay below all vertical furniture.

The projective transform changes the on-stage outline only as required by the
canonical physical footprint and camera calibration. The registered source
alpha remains the sole product-pixel mask and is never repainted.

Malformed or numerically unstable rug geometry falls back to the existing
anchor-based cutout with an accessible selectable control. It cannot crash or
hide the object.

### 7.3 Vertical cutouts and layer order

Vertical cutouts preserve their intrinsic aspect ratio, registered
`anchorX`/`anchorY`, and existing human rotation presentation. Automatic layout
does not introduce new vertical-object rotations because a single cutout cannot
truthfully show a new viewpoint.

Layer order is derived from projected floor-anchor y, followed by stable object
ID tie-breaking. Selection, hover, or focus must not permanently change scene
occlusion. Interaction chrome may render in a separate top layer while product
pixels retain their physical order.

### 7.4 Contact shadows

Non-rug objects receive a pointer-transparent contact-shadow layer centered on
the projected floor anchor. Its width and depth come from the projected physical
footprint, capped by a category profile. Depth controls blur and opacity through
bounded deterministic functions. The shadow never changes the `<img>` alpha,
button hit area, accessible name, or Scene state. Rugs do not receive a second
elliptical shadow.

The shadow, cutout, floor marker, rotation handle, and selected frame must agree
on the same registered anchor. A failed registered image still shows the
existing labelled selectable fallback above its shadow.

## 8. Failure Handling and Recovery

The solver and command validator form a fail-closed boundary:

- An exception, non-finite coordinate, missing object, newly locked object,
  invalid footprint, collision, out-of-room result, or Scene parse failure
  rejects the complete arrangement.
- A manual rejection preserves Scene, revision, `stateVersion`, history,
  selection, and renderer queue, then displays a concise failure status.
- During first-redesign completion, arrangement failure does not roll back the
  valid requested replacement. The response returns the replaced object and
  unchanged placements at the one expected revision.
- Re-entrant clicks are ignored while one synchronous request is being applied.
- Reset and undo cancel visible placement status through the existing UI state
  lifecycle and never cause automatic re-arrangement.
- Rendering or WebGPU failure cannot roll back or alter an accepted Scene
  arrangement; the DOM composition remains complete.

Diagnostics are local enums and numeric summaries suitable for tests and UI
mapping. They do not expose product prose as executable content and are not
sent to a server.

## 9. Accessibility and Responsive Behavior

- The control's accessible name is `Arrange naturally` and visible text matches
  it.
- Disabled state is represented with the native `disabled` attribute.
- Success, no-op, and failure appear in a sighted status area with `role=status`
  and do not move the stage or composer at either reference viewport.
- Existing object buttons remain the semantic and keyboard hit layer. Visual
  rug projection and shadows are `aria-hidden` and pointer-transparent where
  they are not the button itself.
- Reduced-motion users receive no rearrangement animation. The initial version
  commits immediately for every user; no animation state becomes canonical.
- At 1440x900 and 1280x800 the control must not overlap the demo badge, selected
  label, undo toast, stage, or prompt composer.

## 10. Verification and Quality Gates

### 10.1 Unit and component tests

The implementation begins RED and adds focused coverage for:

- deterministic candidate generation and exact tie-breaking;
- locked-object preservation and locked-footprint collision handling;
- room bounds and oriented non-rug collision rejection;
- 0.75m path reachability and opening clearance;
- sofa/table/rug/chair relationships and accessory perimeter preference;
- no-op idempotence and the minimum improvement threshold;
- pure input preservation and failed-solver diagnostics;
- atomic manual revision, `stateVersion`, history, selection, and one-step undo;
- completion-transition detection and exactly-once auto arrangement;
- no auto arrangement for intermediate replacement, stale revision, locked
  object, category mismatch, missing object, reset, or undo;
- one render schedule for an accepted automatic replace or manual move batch,
  and zero schedules for no-op/failure;
- depth scale applied once, relative physical widths, stable anchor z-order,
  rug quadrilateral projection, invalid-rug fallback, and shadow geometry;
- button accessibility, disabled conditions, status visibility, and stable
  layout after success, no-op, and failure.

Tests assert public behavior and computed geometry. They do not grep CSS source
or duplicate the implementation's scoring function as the expected value.
Locked behavior is exercised through a custom validated Scene store rendered
with the real components. The shipped demo exposes no Human UI or Core 6 lock
setter, so browser coverage must not add a test-only state backdoor or seventh
tool solely to manufacture a lock.

### 10.2 Browser journeys

Playwright covers these real-browser journeys:

1. Replace all six unlocked placeholders through the existing Core 6 and prove
   only the final successful replacement produces the natural arrangement.
2. Inspect the completed redesign and prove rug geometry, contact shadows,
   floor-anchor layer order, and the sighted automatic status in the real DOM.
3. Move unlocked objects to a valid but poor composition, choose
   **Arrange naturally**, and prove one revision plus one Undo restores every
   prior position.
4. Choose the button again on the improved Scene and prove no revision or
   renderer request occurs.
5. Prove pointer, keyboard, selection, rotation, failed registered-image
   fallback, clipboard status, reset, cart approval, and Core 6 cardinality
   remain intact.

The focused Playwright command contains no stray literal `--` argument.

### 10.3 Visual acceptance

Fresh seed, completed-redesign, explicit-arrangement, and post-Undo screenshots
are captured at 1440x900 and 1280x800. Review requires all of the following:

- every rug visibly follows the floor plane rather than rising like a vertical
  object;
- sofa, table, chair, lamp, and plant have no implausible footprint collision;
- the seating group reads coherently and the opening remains reachable;
- ordinary product dimension differences remain visible;
- each contact shadow touches its object's registered floor anchor;
- occlusion follows floor depth and rugs stay beneath furniture;
- product pixels are not duplicated, clipped unexpectedly, or replaced;
- hit areas, selected frames, floor markers, and rotation handles stay aligned;
- the new button and every status leave both responsive layouts stable; and
- the browser console contains no application warning or error.

The existing asset audit also verifies registry cardinality, intrinsic
dimensions, alpha, rug `floorQuad`, and exact 1600x900 room images.

### 10.4 Full gate and sequencing

After focused tests, run the complete unit suite, complete Chromium E2E suite,
typecheck, lint, vinext build, and Next build. Then perform independent spec and
code review against this document and the two governing photo specifications.

Any failure, visual concern, or review finding blocks the WebGPU spike. The
spike and hybrid renderer implementation plan do not resume until this static
placement work is green. Merge, push, deploy, and local MCP companion
implementation remain out of scope.

## 11. Acceptance Criteria

The feature is ready for the static photo-compositor gate only when:

- initial arrangement runs on the precise unlocked-placeholder completion
  transition and nowhere else;
- the public WebMCP tool set and schemas remain unchanged;
- a manual arrangement is atomic, idempotent, selected-state preserving, and
  reversible with one Undo;
- locked objects never move and impossible locked layouts fail safely;
- placement is deterministic and satisfies room, collision, opening, path, and
  category relationship rules;
- rug, relative scale, anchor, z-order, and contact-shadow projection pass both
  computed tests and two-viewport visual review;
- manual failures and no-ops mutate and schedule nothing, while an automatic
  arrangement failure preserves and schedules only its valid replacement;
- every focused and full verification command passes on the final commit;
- independent review reports no unresolved Important or higher finding; and
- the branch remains unmerged and unpushed for user review.
