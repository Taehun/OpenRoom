# Nook Hybrid Image Renderer Design

**Date:** 2026-09-02

**Status:** Draft for written-spec review. The revised in-chat design 3/3 was
approved on 2026-09-02; implementation remains blocked until this document is
reviewed and approved.

**Depends on:** `feat/photo-compositor` after its final-review repairs pass the
full verification and visual-review matrix.

**Scope:** Add an optional, frontend-only WebGPU image harmonization layer above
Nook's existing deterministic DOM photo compositor without changing Scene JSON,
the command layer, the WebMCP Core 6, undo, selection, registration cleanup, or
cart approval boundaries.

## 1. Outcome

Nook continues to place the exact registered furniture cutouts at positions,
sizes, rotations, and floor anchors derived from the canonical Scene. On an
explicitly opted-in, supported device, a dedicated browser worker may improve
only the composite's lighting, color temperature, boundary integration,
grounding, and necessary contact shadows. It cannot redesign the room, move an
object, change a silhouette, invent a product, remove product detail, or mutate
Scene state.

The current DOM compositor remains the immediate editor and universal fallback.
An accepted model result is a derived visual artifact, never a new source of
truth.

## 2. Governing Invariants

The renderer must preserve all of these existing boundaries:

- Validated `Scene` JSON is the only persisted room/object model.
- Zustand and the existing command layer remain the only route for committed
  human and agent mutations.
- `replace` and `move` retain their current revision, `stateVersion`, history,
  stale-state, lock, category, selection, and undo behavior.
- The WebMCP surface remains exactly the Core 6: `get_scene`, `get_selection`,
  `search_products`, `replace_object`, `move_object`, and
  `add_scene_to_cart`.
- No generic execute, render, batch, image, or model tool is added.
- `add_scene_to_cart` continues to open only the existing local approval UI and
  performs no external cart request.
- DOM cutouts remain accessible buttons and the active pointer, keyboard,
  selection, focus, floor-anchor, and rotation-handle layer.
- Unsupported, disabled, downloading, stale, cancelled, or failed enhancement
  always leaves a complete human editor.
- The application has no server inference route, API key, photo upload, room
  image upload, prompt upload, or Scene upload.
- The local MCP companion remains a separate, deferred work package.

## 3. Selected Approach

### 3.1 Geometry-locked parametric harmonization

The primary candidate is a PIH-style parametric harmonizer. It predicts bounded
RGB curves and local gain/shading maps. Nook applies those parameters to the
original cutout RGB while retaining the original alpha exactly. The model does
not return replacement product pixels that can be displayed directly.

Adobe PIH is the first spike candidate because its architecture is designed for
real-composite color, tone, and local illumination harmonization. Its public
repository is Apache-2.0 and describes a 93M-parameter checkpoint. The spike
must separately prove that the checkpoint license, conversion path, ONNX graph,
and WebGPU operator coverage are acceptable; the repository license alone is
not sufficient evidence for shipping weights.

### 3.2 Restricted inpainting candidate

Moebius 0.22B and its browser ONNX conversion are the second and final spike
candidate. Moebius must not resynthesize product pixels. It may be evaluated
only for a bounded contact-shadow or boundary proposal outside the immutable
product alpha. Its reported approximately 1.27 GB first download is within the
product's permitted 1-2 GB first-use envelope, but it still must pass every
license, cache, memory, latency, privacy, and product-preservation gate.

If the parametric candidate fails, Nook does not silently broaden the
inpainting candidate's authority. If neither candidate meets this design, the
spike stops and the DOM compositor remains the product renderer.

### 3.3 Deterministic fallback

The current DOM/CSS compositor is not removed or demoted to a test fixture. It
is the always-available renderer and the active visual during direct
manipulation. Existing deterministic drop shadows may remain, but no fallback
path may pretend that model enhancement succeeded.

## 4. Derived Render Input and Identity

### 4.1 Render snapshot

A `RenderSnapshot` is an immutable, renderer-specific projection of a validated
Scene. It contains only visual inputs:

- `sceneId` and `revision`;
- room background asset ID and asset-registry version;
- photo calibration version and render-profile version;
- ordered object ID, type, source, asset ID, position, Y rotation, dimensions,
  and computed anchor/placement data;
- fixed output width and height.

Selection, lock state, price, product prose, cart state, history, tool mode, and
`stateVersion` are excluded because they do not change rendered pixels.

### 4.2 Content hash

The renderer recursively key-sorts and UTF-8 serializes the render snapshot,
then computes lowercase SHA-256. A render key is:

```text
sceneId / revision / contentHash / modelVersion / renderProfileVersion
```

`revision` alone is insufficient because undo can restore an earlier revision.
`contentHash` prevents an ABA collision. A result is displayable only if its
`sceneId`, `revision`, and `contentHash` all match the current derived Scene;
model and profile versions must also match the active renderer.

### 4.3 Render artifact lifetime

Accepted room images and `ImageBitmap` objects remain in memory only. They are
closed on eviction, stale-result rejection, renderer disable, cache clear, and
unmount. Nook does not persist rendered room composites in Cache Storage,
IndexedDB, local storage, or a server.

## 5. Scheduling Boundary

`createSceneStore` gains an optional post-commit observer supplied by the demo
runtime. The store invokes it only after an existing `applyCommand` call has:

1. returned `ok: true`;
2. installed the returned Scene in Zustand; and
3. identified the applied command as `replace` or `move`.

The observer receives an immutable render snapshot built from the committed
Scene. It is not stored in Scene or history, cannot alter the command result,
and cannot throw back into command execution. Renderer failures are isolated
from mutation success.

Therefore:

- a successful human or WebMCP replace/move schedules that committed revision;
- pointer and rotation previews do not schedule;
- stale revision, locked object, category mismatch, missing object, invalid
  input, or missing selection does not schedule;
- selection, tool-mode, clipboard, cart, undo, and reset do not schedule;
- undo/reset may reuse an exact in-memory artifact only when the entire render
  key matches; otherwise they show the DOM compositor.

The coordinator has a latest-wins queue. A newer eligible commit marks older
jobs stale. An uninterruptible `InferenceSession.run()` may finish, but its
result is discarded and never flashes. The queued latest snapshot runs next.
User cancellation or fatal device failure terminates the worker immediately.

## 6. Visual Layering and Direct Manipulation

The stage has three visual layers:

1. the existing room background and DOM cutout visuals;
2. an optional accepted raster canvas;
3. DOM buttons, hit areas, selection/focus UI, floor markers, and handles.

Before an exact raster is accepted, layer 1 is visible. When an exact raster is
shown, cutout image pixels in layer 3 become transparent while the semantic
buttons and editing chrome remain interactive. There is no duplicate visible
product.

Pointer-down, keyboard movement, rotation preview, undo, reset, or any key
mismatch hides the raster and reveals the full DOM compositor synchronously.
Direct manipulation never waits for the model. A successful pointer release
commits once through the existing command layer and then schedules enhancement.

The accepted raster is drawn at 1024x576 and scaled into the existing responsive
16:9 stage. The 1440x900 and 1280x800 workspace layouts do not gain a separate
geometry or breakpoint model.

## 7. Worker and Runtime Architecture

### 7.1 Dedicated worker

One dedicated module worker owns:

- ONNX Runtime Web's WebGPU import;
- WebGPU adapter, device, and inference session;
- immutable model manifest and verified shard handles;
- `OffscreenCanvas`, decoded `ImageBitmap` inputs, masks, and composition;
- inference and post-processing;
- transferable result `ImageBitmap` objects.

Nook does not use ONNX Runtime's proxy-worker mode because that proxy cannot be
combined with the WebGPU execution provider. WebGPU and the model session are
created directly inside Nook's worker.

### 7.2 Worker protocol

The typed protocol contains exact messages for:

- capability probe request/result;
- download start/progress/verify/complete;
- initialize/ready;
- render request/progress/result;
- cancellation acknowledgement;
- cache inspection/deletion;
- offline, quota, integrity, unsupported, device-lost, out-of-memory, model,
  quality, and unexpected failures.

Every render request and result includes `jobId` plus the full render key.
Messages are runtime-validated before the controller changes UI or accepts an
image. Unknown, malformed, duplicate, and completed job IDs are ignored and
their transferables released.

### 7.3 Main-thread controller

The controller owns only renderer lifecycle state, the latest requested key,
the currently accepted artifact, and bounded diagnostics. It reads canonical
Scene state to revalidate results but never writes Scene, revision,
`stateVersion`, history, selection, or cart state.

## 8. Geometry and Product-Preservation Enforcement

### 8.1 Deterministic base composite

The worker reconstructs the same registered room and object projection as the
DOM compositor. Registry dimensions, anchorX/anchorY, calibration, scale, layer
order, and Y rotation are explicit inputs. The photo-compositor final-review
repairs are therefore a hard prerequisite to the spike.

### 8.2 Immutable alpha authority

The checked-in cutout alpha is authoritative:

- output alpha is copied from the original, never predicted;
- output bounding box, centroid, anchor, position, size, rotation, and layer
  order are deterministic and unchanged;
- harmonized RGB is clipped to original nonzero alpha;
- boundary correction may feather RGB only inside the original edge pixels;
- no model-generated foreground pixel may appear outside original alpha.

### 8.3 Contact shadows

An external change is permitted only inside a deterministic floor-contact mask
derived from the object's anchor, projected width/depth, and floor plane. The
mask is bounded to the lower 12% of the object's projected height, extends no
more than 8% of projected width on either side, and cannot overlap another
product's immutable foreground alpha. Shadow opacity is clamped to 0.28 and
blur radius to 18 output pixels.

If the candidate cannot obey those limits, its shadow output is rejected and
the deterministic DOM shadow remains. Shadow rejection does not reject an
otherwise valid parametric foreground harmonization.

### 8.4 Automatic acceptance checks

A result must satisfy all of the following before display:

- finite tensors, exact dimensions, expected channel order, and legal ranges;
- bit-identical alpha, bounding box, centroid, and anchor;
- zero changed pixels outside original alpha plus approved contact masks;
- masked foreground SSIM of at least 0.92 against the registered product;
- no clipped highlight/shadow population above 0.5% of opaque product pixels;
- exact current render-key match after all checks finish.

Failure rejects only that result and restores the DOM compositor.

## 9. Model Download Consent and Progress

No model request occurs before a user explicitly activates `Use enhanced
rendering`.

Before download, the UI shows model name/version, actual manifest byte count,
the 2 GB hard maximum, expected local storage use, local-inference statement,
and cache controls. Consent is version-specific and stored only after the user
starts that version's download.

The immutable manifest metadata needed to show that disclosure is checked into
the application and bundled with the renderer. Reading it requires no model
network request. The user's action authorizes only the exact weight-shard GETs
listed by that local manifest.

The visible states are:

```text
Not downloaded → Downloading → Verifying → Initializing → Ready
```

Downloading shows received bytes and total bytes. Percentage is shown only when
the server supplies a trustworthy total. The UI never invents progress.

Fetch and verification use `AbortController`. `Cancel` aborts active requests,
terminates initialization/inference when needed, removes temporary cache
entries, and returns to the DOM compositor. A partial or unverified shard is
never marked ready.

## 10. Model Cache and Offline Behavior

Cache Storage holds immutable, versioned model and external-data responses.
IndexedDB holds the small manifest, hashes, verified-complete marker,
version-specific consent, byte counts, and access metadata. The ready marker is
written only after every shard passes SHA-256 verification, giving the cache an
atomic complete/incomplete boundary.

`Delete model cache` performs these actions in order:

1. stop and terminate the worker/session;
2. close current render artifacts;
3. delete the model version's Cache Storage entries;
4. delete its IndexedDB metadata and consent;
5. show the DOM compositor and `Not downloaded` status.

A complete verified warm cache can initialize and render offline. Offline with
no complete cache shows `Enhanced rendering is unavailable offline` and makes
no retrying network request. Incomplete metadata or shards are ignored and
offered for cleanup, never resumed without a fresh explicit download action.

Consent persists per model version, but GPU initialization remains a
per-document action. On a later visit Nook may inspect the small local metadata
and show `Downloaded`; it does not allocate a GPU device or load weights until
the user activates enhanced rendering for that document. That action uses the
verified warm cache without another download and also works offline.

The implementation must stream responses into Cache Storage and avoid a second
full-size in-memory copy. If the selected ONNX/external-data path requires
materializing another complete 1-2 GB `ArrayBuffer`, the memory gate fails.

## 11. Capability Detection and Fallback

Capability detection runs in this order:

1. dedicated Worker and OffscreenCanvas availability;
2. `navigator.gpu`/worker WebGPU availability;
3. `requestAdapter()` and required device limits;
4. a small application-bundled ONNX WebGPU session and tensor probe that makes
   no model-network request;
5. model-specific session initialization after verified consent/cache.

Any failure before step 5 disables model download for the session and displays
`Enhanced rendering is unsupported on this device; using photo placement`.
The large model is not attempted through WASM or WebGL as an automatic
fallback. The fallback is the existing DOM compositor.

Fatal worker, device, session, or memory errors close the current artifact and
return to DOM immediately. Two consecutive fatal failures open a session-local
circuit breaker; another probe requires a visible `Retry enhanced rendering`
action. Device failure does not delete a valid model cache.

Integrity and quota errors explain whether the user should retry, free space,
or delete the model cache. Model output quality failure is reported separately
from device support failure.

## 12. Privacy and Network Boundary

The only renderer network requests are explicit-consent GET requests for the
immutable weight shards in the checked-in manifest. The manifest contains exact
URLs, allowed origins, byte sizes, SHA-256 hashes, model/version identifiers,
and license metadata. Wildcard or mutable latest-version URLs are rejected.
Redirects to an origin outside the exact manifest allowlist are rejected.

Renderer requests contain no room pixels, cutout pixels, Scene, selection,
prompt, product data, cart data, identifier, telemetry payload, or API key.
Weight requests use `credentials: "omit"` and `referrerPolicy: "no-referrer"`.
They may target the exact same-origin or cross-origin static model host pinned
by the manifest; no other cross-origin request is allowed. After a complete
warm cache is available, initialization and rendering make zero model-network
requests. No POST, PUT, PATCH, DELETE, beacon, form, or request carrying
application data is introduced.

Static room and cutout assets remain the checked-in same-origin application
assets. Clearing the model cache does not delete those assets or application
state.

## 13. Human Interface

The stage top bar gains a compact `Enhanced rendering` control and visible
status. It must not displace the existing tools, object rail, inspector, prompt
guidance, cart action, or diagnostics at either required viewport.

Required visible states and actions are:

- unsupported: reason plus DOM fallback statement;
- not downloaded: `Use enhanced rendering`;
- downloading: byte progress plus `Cancel`;
- verifying/initializing: truthful phase plus `Cancel`;
- ready/rendering: current phase and DOM-preview statement;
- enhanced: current revision is enhanced;
- failed: concise cause, `Retry`, and `Delete model cache` when relevant;
- offline cache ready: `Ready offline`;
- offline cache absent: unavailable offline and DOM fallback.

The same meaningful status is exposed through a polite live region. Long model
details and license attribution live in a disclosure panel rather than the
primary editing path.

## 14. Photo-Compositor Repair Gate

Before any WebGPU spike work, `feat/photo-compositor` must fix and re-review:

1. move and rotation previews from pointer-down position, starting floor
   anchor, and starting pointer angle deltas;
2. per-asset anchorX/anchorY in translation, transform-origin, rotation handle,
   and floor marker placement;
3. exactly one depth-scale application and category-aware visual-width bounds
   that preserve real product size differences;
4. registered `<img>` load-error fallback plus error reset on `src` change;
5. exact asset registry cardinality, dimensions, alpha, and identical 16:9 room
   crop checks;
6. sighted clipboard success/failure feedback and rejection coverage;
7. a stale E2E move target different from the restored position;
8. focused Playwright commands with no misplaced literal `--`;
9. documentation that `document.modelContext` is injected for the document
   lifetime before mount because the platform exposes no post-mount event.

The focused tests, full unit/E2E/typecheck/lint/vinext/Next matrix, and fresh
1440x900 plus 1280x800 visual review must pass before the spike starts.

## 15. Time-Boxed WebGPU Spike

The spike has a hard limit of four engineer-hours and at most two candidate
conversions. Model download wall time may use up to an additional 30 minutes,
but debugging does not continue beyond the four-hour work limit.

### 15.1 Format and legal gate

- pinned upstream checkpoint, conversion inputs, and output hashes recorded;
- code, weights, conversion, and redistribution/commercial-use licenses all
  explicit and compatible;
- ONNX plus external-data structure accepted by current ONNX Runtime WebGPU;
- transferred model bytes no more than 2 GB and verified cache no more than
  2.5 GB;
- no mutable URL or unverified community artifact in the shipping proposal.

### 15.2 Cold, warm, and offline gate

- cold download exposes real progress, cancels cleanly, and verifies hashes;
- cancel updates UI and halts active network within one second;
- warm cache causes zero weight requests and reaches ready in at most 20
  seconds on the reference machine;
- complete cache works offline; missing/incomplete cache falls back without a
  retry loop;
- cache deletion reclaims the model entries and returns to DOM.

### 15.3 Performance and stability gate

Reference environment is the current development Mac and latest stable
Chromium with recorded browser, GPU adapter, ONNX Runtime, model, and OS
versions.

- 1024x576 render, ten-run median no more than 8 seconds;
- ten-run p95 no more than 12 seconds;
- ten sequential successful replace/move renders without crash, OOM,
  `device.lost`, stale flash, or leaked artifacts;
- measured browser/GPU incremental peak no more than 3 GB;
- no renderer-attributable main-thread long task above 100 ms;
- worker termination returns visible DOM fallback within one second.

### 15.4 Quality gate

- automatic checks run for all six seed and eighteen catalog assets;
- one representative asset from each category is reviewed at near and far
  depth, yielding twelve golden composites;
- silhouette, placement, scale, rotation, material, legs/arms, lamp shade and
  stem, plant leaves and planter remain identifiable;
- grounding, lighting, color temperature, and boundaries improve without room
  redesign or product substitution;
- 1440x900 and 1280x800 screenshots pass side-by-side review.

Failure of any legal, format, cache, offline, performance, memory, privacy, or
quality gate ends the spike. The next deliverable is a failure report naming the
measured cause, not product renderer code.

## 16. Test Strategy

### 16.1 Pure unit tests

- canonical render serialization and SHA-256 stability;
- render-equivalent fields included and nonvisual fields excluded;
- content hash distinguishes revision-ABA scenes;
- geometry masks, immutable alpha, contact-shadow bounds, and quality metrics;
- strict worker message parsing and duplicate/unknown job disposal;
- cache manifest, hash, completeness, versioning, and deletion;
- capability and error classification.

### 16.2 Fake-worker store/controller tests

A deterministic `RendererWorkerPort` fake controls progress, results,
out-of-order delivery, cancellation, and every failure code. Tests prove:

- no worker/model request before consent;
- only successful replace/move receipts schedule;
- stale, locked, mismatch, missing object/selection, invalid input, selection,
  undo, reset, clipboard, and cart do not schedule;
- newer revision wins and stale/mismatched sceneId/revision/contentHash results
  never display;
- duplicate results close their bitmaps and do not replace the accepted image;
- download cancellation, integrity failure, quota failure, worker crash, OOM,
  device loss, and quality failure restore DOM;
- complete cache works offline and incomplete cache does not;
- fatal retry circuit breaker requires a user action.

### 16.3 Component and fake-worker browser tests

- DOM cutouts are immediately visible before and during enhancement;
- accepted raster hides only DOM pixels, not semantic buttons or controls;
- pointer/keyboard preview synchronously restores full DOM visuals;
- selection, focus, rotation handle, object rail, undo, reset, and cart approval
  work while enhanced;
- all renderer states and errors are visible and announced;
- no model request occurs before consent;
- warm render and cart interactions emit zero external or mutation requests;
- Core 6 names, annotations, execution, stale safety, and cleanup remain exact.

### 16.4 Real WebGPU smoke

Real smoke tests are not replaced by the fake worker and are not silently
skipped. They record cold/warm/offline/cancel/cache-clear behavior, performance,
memory, browser console, request log, ten sequential revisions, automatic
quality metrics, and both required viewport screenshots. Product implementation
cannot begin until the spike report shows every Section 15 gate passing.

## 17. Dependency and File Boundary

The eventual implementation may add only the pinned ONNX Runtime Web package
and focused renderer/cache test utilities. It must not add a server framework,
cloud SDK, analytics SDK, model API client, image upload package, or a second
state-management library.

Expected implementation boundaries are:

- pure render snapshot/hash/quality modules;
- renderer commit observer and latest-wins coordinator;
- typed worker protocol and worker runtime;
- model manifest, download, integrity, cache, and offline modules;
- raster display and renderer status UI;
- fake worker plus focused unit/component/E2E coverage;
- a throwaway, clearly isolated spike harness and written spike report.

The implementation plan will choose exact filenames and commit slices after
this design is approved.

## 18. Acceptance Criteria

- Existing photo-compositor final-review findings are fixed and re-reviewed
  before the renderer spike.
- No model bytes are requested without explicit, version-specific consent.
- Download, byte progress, verification, cancellation, cache deletion, warm
  cache, and offline states behave as specified.
- Unsupported WebGPU and every renderer failure preserve the complete DOM
  editor without changing Scene or tool behavior.
- Only successful replace/move commands schedule internal rendering.
- Every displayed result matches current `sceneId`, `revision`, and
  `contentHash`, plus model/profile versions.
- Model output cannot change product alpha, position, scale, rotation, anchor,
  silhouette, category, or identity.
- Core 6, `stateVersion`, revision safety, undo, selection, registration
  cleanup, and cart approval semantics remain exact.
- Fake-worker lifecycle tests and real WebGPU smoke criteria both pass.
- The full unit, E2E, typecheck, lint, vinext build, Next build, static-asset,
  network/privacy, visual, and `git diff --check` matrix passes.
- No merge, push, deployment, model-server call, room upload, or external cart
  write occurs.

## 19. Delivery Order

1. Review and approve this separate design document.
2. Write and approve a separate implementation plan.
3. Repair and commit the photo-compositor final-review findings with TDD.
4. Run the full matrix, two-viewport visual QA, and final photo re-review.
5. Run the time-boxed WebGPU spike and publish its evidence.
6. Stop on any failed spike gate and report the cause.
7. If every spike gate passes, implement renderer lifecycle, cache, worker,
   fallback, and UI in small RED-to-GREEN commits.
8. Run the complete final matrix and report choices without merge, push, or
   deploy.

## 20. Sources

- ONNX Runtime Web WebGPU execution provider:
  <https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html>
- ONNX Runtime Web environment and worker constraints:
  <https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html>
- ONNX Runtime Web large-model loading and cache guidance:
  <https://onnxruntime.ai/docs/tutorials/web/large-models.html>
- Adobe PIH repository and checkpoint description:
  <https://github.com/adobe/PIH>
- Adobe Research, Semi-supervised Parametric Real-world Image Harmonization:
  <https://research.adobe.com/publication/parametric-harmonization/>
- Moebius upstream repository and license:
  <https://github.com/hustvl/Moebius>
- Browser-oriented Moebius ONNX conversion model card:
  <https://huggingface.co/simonw/Moebius-ONNX>
