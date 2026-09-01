# Nook Photo Compositor and Local Agent Bridge Design

**Date:** 2026-09-01

**Status:** Approved in chat; pending written-spec review

**Scope:** Replace the interactive 3D room with a photo-based DOM compositor and make the existing Core 6 tools available to both native WebMCP agents and local Claude MCP clients.

## 1. Outcome

Nook opens on a deliberately dated, mismatched living room. The room is a fixed-perspective photograph with six independently selectable furniture cutouts layered above it. A user gives an interior-design prompt to an AI agent, such as:

> Replace the outdated furniture with a warm minimal Japandi interior. Keep the sofa on the left and create a clear path to the windows.

The agent inspects the live Scene, searches a deterministic product catalog, replaces the old objects, and adjusts their positions with Nook's existing WebMCP Core 6 tools. Each resulting object remains individually selectable, movable, rotatable, undoable, and eligible for the existing approval-only cart flow when it represents a catalog product.

There is no runtime image generation. The background and cutouts are static, versioned demo assets, so the same prompt and tool sequence remains reviewable and reproducible.

## 2. Goals

- Remove the 3D/WebGL renderer and its dependencies.
- Render a fixed room photograph with photorealistic transparent furniture cutouts in ordinary DOM layers.
- Preserve the existing `Scene` JSON as the canonical model, including room-space `x/z` positions, selection, revisions, `stateVersion`, undo, locks, and command results.
- Preserve the existing command layer as the only way to commit replacement and movement.
- Preserve the WebMCP Core 6 names, strict JSON Schemas, Zod validation, structured `ToolResult`, registration lifecycle, stale-state protection, and approval-only cart behavior.
- Let ChatGPT Work and Codex use the page through native WebMCP site tools.
- Let Claude Desktop and Claude Code use the same live page and the same Core 6 contract through a localhost-only MCP companion.
- Keep the human UI fully usable without any agent connection.

## 3. Non-goals

- Runtime calls to an image model, vision model, OpenAI API, Anthropic API, Shopify, Tripo, R2, or D1.
- A generic execute, batch-mutation, or natural-language execution tool.
- A second copy of Scene state in the companion process.
- Direct support for `claude.ai` web through a publicly reachable remote MCP server.
- Claiming native WebMCP support for the Claude Chrome extension when Anthropic does not document it.
- Photogrammetric reconstruction, occlusion masks, relighting, or physically correct 3D perspective.
- Uploading arbitrary room photos in this package.
- Mobile editing. The current desktop-first viewport policy remains.

## 4. Compatibility Boundary

| Agent surface | Connection | Supported behavior |
| --- | --- | --- |
| ChatGPT Work in the ChatGPT desktop built-in browser | Native `document.modelContext` WebMCP | Discovers and executes Core 6 against the active page |
| Codex in the ChatGPT desktop built-in browser | Native `document.modelContext` WebMCP | Discovers and executes Core 6 against the active page |
| Claude Desktop | Local stdio MCP companion plus paired page relay | Executes the same Core 6 against the paired active page |
| Claude Code | Local stdio MCP companion plus paired page relay | Executes the same Core 6 against the paired active page |
| Claude Chrome extension by itself | Accessible DOM/browser automation fallback | Human controls remain operable, but structured WebMCP parity is not promised |
| `claude.ai` web | Not included | Would require a separately deployed remote MCP server |
| Unsupported browsers and agents | No agent adapter | Human photo editor remains fully usable |

OpenAI documents site tools as ChatGPT's implementation of the proposed WebMCP standard and states that ChatGPT Work and Codex can discover them in the ChatGPT desktop app's built-in browser: <https://learn.chatgpt.com/docs/webmcp>.

Anthropic documents local MCP connectivity for Claude Desktop and Claude Code, while its Chrome integration is documented as browser automation rather than WebMCP site-tool discovery: <https://docs.anthropic.com/en/docs/claude-code/mcp> and <https://support.anthropic.com/en/articles/12012173-getting-started-with-claude-for-chrome>.

## 5. Human Experience

### 5.1 Initial room

The demo stage uses a high-resolution empty-room image derived from the current `public/demo/nook-room.png` composition. Six seed cutouts are layered above it:

1. an overstuffed dated sofa,
2. an incompatible glass or dark-wood coffee table,
3. a loud patterned rug,
4. an ornate floor lamp,
5. a vinyl or heavily upholstered accent chair,
6. an artificial-looking potted plant.

These objects retain the existing IDs (`sofa_01`, `table_01`, `rug_01`, `lamp_01`, `chair_01`, and `plant_01`). They use `source: "placeholder"`, have explicit `assetId` values, and are not cart-eligible.

### 5.2 Photo stage

`RoomPhotoStage` replaces the dynamically imported `SceneCanvas` inside the existing `RoomCanvas` shell. It contains:

- a responsive 16:9 background image,
- one bottom-center-anchored DOM button per Scene object,
- a transparent cutout image inside each object button,
- a selection outline and floor anchor for the active object,
- the existing toast, diagnostics, object rail, inspector, product panel, activity panel, and cart approval sheet.

The top badge changes from “Approximate visualization” to “Photo placement”. The region is labelled “Editable room photo”. The existing object rail remains a non-pointer control path.

### 5.3 Interaction

- **Select:** Clicking a cutout or its object-rail entry selects it. Clicking uncovered background clears the selection.
- **Move:** Dragging an unlocked object previews the position locally and commits exactly one existing `move` command on pointer release. A cancelled drag commits nothing.
- **Rotate:** A selected, unlocked non-rug object exposes a compact rotation handle. Rotation previews locally and commits through the existing `move` command's `rotationYDegrees` field on release.
- **Keyboard:** Focused objects support Enter/Space to select, arrow keys to move in calibrated increments, and Shift+Arrow for larger increments. Rotate mode uses Left/Right to adjust rotation. Keyboard changes also commit through the command layer.
- **Locked objects:** Remain selectable but expose no move or rotate affordance.
- **Undo/reset:** Continue to use the current store operations and restore the exact prior Scene.

The component may keep transient drag coordinates in local React state, but it must not write a second persisted object model.

### 5.4 Prompt guidance

The current in-page `Run Agent move` form is removed because a webpage cannot initiate the user's ChatGPT or Claude conversation through WebMCP. It is replaced by:

- one primary example prompt,
- two shorter style prompt suggestions,
- a “Copy prompt” action,
- a connection-status area showing native WebMCP availability and local Claude pairing state,
- concise instructions to paste the prompt into the active agent surface.

The prompt copy is guidance only. It does not call a model or mutate Scene state.

## 6. Static Asset System

### 6.1 Asset inventory

The package contains:

- one 16:9 empty-room background at a minimum intrinsic width of 1600 pixels,
- one static landing-page “before” composite matching the seed Scene,
- six transparent seed cutouts for the dated furniture,
- eighteen transparent catalog cutouts: three products for each of sofa, coffee table, rug, floor lamp, chair, and plant.

The eighteen catalog products cover three coherent style families—Japandi, modern organic, and mid-century—while keeping independent color, material, dimensions, and style tags for agent search.

### 6.2 Resolution and mapping

- Background and composite assets use WebP or JPEG based on measured output size and visual quality.
- Cutouts use lossless-alpha WebP or PNG and retain transparent margins only where required for contact shadows.
- A versioned `photo-assets` registry maps seed `assetId` and catalog product IDs to local paths, intrinsic dimensions, and a bottom-anchor correction.
- A replaced Scene object sets `object.assetId` to the selected product ID. Existing Scene and product schemas do not need a new URL field.
- Missing or failed cutout assets render an accessible labelled placeholder without breaking selection, commands, or tools.
- Product and catalog text remains untrusted agent output exactly as in the current Core 6 annotations.

The assets are generated once during implementation and checked into `public/demo`. They are not generated or downloaded by the application at runtime.

## 7. Room-space Projection

The existing Scene remains measured in room metres. A pure `photo-projection` module maps between room-space `(x, z)` and normalized stage coordinates.

### 7.1 Calibration

The empty-room background has a fixed calibration record containing:

- normalized back-left and back-right floor points,
- normalized front-left and front-right floor points,
- a back-floor and front-floor vertical coordinate,
- minimum and maximum visual scale,
- optional per-category bottom-anchor offsets.

At a given normalized depth, the projector interpolates the visible left and right floor limits. Scene `x` maps within those limits. Scene `z` maps between the back and front floor coordinates. The same interpolation is inverted for pointer drag, then passed to the command layer, which remains responsible for room bounds and clamping.

### 7.2 Visual depth

- Scale interpolates from the calibrated back scale to the front scale.
- DOM stacking order is based on depth, with a lower layer bias for rugs.
- Object width is influenced by real product dimensions but clamped to calibrated visual bounds.
- CSS rotation displays the existing Scene Y rotation as an approximate photo-layer rotation around the bottom-center anchor.

Projection is deliberately approximate and deterministic. The UI continues to disclose that object placement is a preview, not a physical guarantee.

## 8. Catalog and Agent Journey

The deterministic catalog expands from three coffee tables to eighteen products across all six supported categories. `search_products` keeps its maximum result count of three, stable ordering, category filter, query handling, Zod validation, and cloned outputs.

No new agent tool is required. A whole-room redesign uses the existing single-purpose tools:

1. `get_scene`
2. `search_products` for each relevant category
3. `replace_object` for each unlocked seed object
4. `move_object` where the selected composition requires adjustment
5. `get_scene` to verify the final state

Each mutation uses the latest `sceneRevision` and `stateVersion` returned by the previous tool result. A stale call stops safely and the agent must read current state before retrying. Successful replacement or movement remains exactly one command and one revision increment. Partial progress is visible and undoable; there is no hidden transaction or generic batch executor.

## 9. Shared Tool Runtime and Adapters

### 9.1 Transport-neutral manifest

The Core 6 names, descriptions, JSON Schemas, and annotations move into one serializable manifest consumed by:

- the current Zod-backed browser handler layer,
- the native WebMCP registration adapter,
- the local MCP companion,
- parity tests.

Zod remains the code-level validator. Tests continue to enforce that the serializable JSON Schema and Zod behavior agree on bounds, strictness, and required fields.

### 9.2 Native WebMCP adapter

The current `document.modelContext` feature detection, registration, abort-signal cleanup, `(input, { signal })` callback contract, and structured result envelope remain. The photo renderer does not affect tool registration.

### 9.3 Page relay adapter

The page relay wraps the same `createCoreTools(context)` descriptors. It accepts a companion request containing a tool name and input, finds the descriptor, supplies a per-call AbortSignal, executes it against the live Zustand store, and returns the unchanged `ToolResult`.

There is no independent relay implementation of search, replace, move, selection, or cart behavior.

## 10. Local MCP Companion

### 10.1 Process model

`pnpm mcp:nook` starts one Node process with:

- an MCP stdio server for Claude Desktop and Claude Code,
- a loopback HTTP relay bound only to `127.0.0.1`,
- an in-memory pairing/session registry,
- the serializable Core 6 manifest.

The companion uses stdout exclusively for MCP protocol messages. Pairing instructions and diagnostics go to stderr. The official MCP SDK is the only new runtime dependency required by the companion.

The relay listens on `127.0.0.1:43110` by default. `NOOK_MCP_PORT` may select a different unprivileged port. The built-in development origin allowlist is exactly `http://localhost:3000` and `http://127.0.0.1:3000`; any deployed origin is rejected unless the user explicitly adds it through `NOOK_ALLOWED_ORIGINS` when starting the companion.

### 10.2 Pairing

1. The process prints a six-digit, single-use pairing code and the loopback port.
2. The user opens Nook's “Connect Claude” control and enters the code.
3. The page sends its exact origin, manifest hash, and a random page nonce to the loopback pairing endpoint.
4. The companion verifies the code, expiry, allowed origin, and manifest hash, then returns a random in-memory session token.
5. The page starts authenticated long polling for tool calls and posts results to the matching request ID.
6. Pairing expires on tab unload, relay timeout, companion termination, or replacement by a newly approved tab.

Only one page session may be paired at a time. The pairing code expires after ten minutes and cannot be reused.

### 10.3 Tool calls

- MCP `tools/list` is served from the shared static manifest.
- Before pairing, `tools/call` returns a concise page-unavailable tool error.
- After pairing, each call is forwarded to the page with a unique request ID.
- The page executes the actual browser descriptor and posts the structured result.
- A disconnect or timeout aborts the browser handler where possible and returns an MCP error without retrying a mutation.
- The companion never caches Scene, selection, catalog, cart, or tool output beyond the active request.

### 10.4 Claude setup

Documentation provides explicit Claude Desktop and Claude Code configuration examples pointing to `pnpm mcp:nook`. Nook does not edit global Claude configuration automatically.

## 11. Security and Approval

- Bind the relay to `127.0.0.1`, never `0.0.0.0`.
- Require the one-time pairing code before issuing a session token.
- Keep pairing and session credentials in memory only.
- Permit only the two built-in local development origins or exact origins explicitly supplied through `NOOK_ALLOWED_ORIGINS`.
- Reject private-network preflights, origins, methods, content types, bodies, tool names, or manifest hashes that do not match the contract.
- Respond to valid Chromium Private Network Access preflights only for an allowed origin.
- Cap request bodies at 64 KiB, concurrent pending calls at eight, and individual tool calls at 30 seconds.
- Invalidate a page session after 45 seconds without a successful authenticated long-poll heartbeat.
- Validate every tool input again in the browser through the existing Zod schemas.
- Forward only Core 6; do not expose filesystem, shell, network, arbitrary JavaScript, or generic execution.
- Preserve `readOnlyHint` and `untrustedContentHint` in both adapters.
- Preserve explicit approval semantics: Scene mutations are visible and undoable, while `add_scene_to_cart` only opens the local approval sheet and performs no external write.
- Do not send the room photograph, Scene, product data, or pairing token to any Nook-controlled external service.

The companion does not make Claude or ChatGPT local in the model-hosting sense; it keeps the Nook tool transport and Scene execution local. Model traffic remains governed by the user's chosen agent product.

## 12. Error Handling

| Condition | Behavior |
| --- | --- |
| `document.modelContext` absent | Native adapter is skipped; human UI and local companion remain available |
| Companion not running | Pair UI shows local connection unavailable; native WebMCP and human UI remain available |
| Invalid/expired pairing code | Pairing is rejected without revealing whether another page is connected |
| Origin or manifest mismatch | Pairing is rejected and logged to stderr without returning secrets |
| Page reload/disconnect | Active page session is invalidated; pending calls fail and mutations are not retried |
| Tool timeout | Per-call AbortController is triggered; MCP returns a concise retryable transport error |
| Stale revision/stateVersion | Existing structured `SCENE_REVISION_CONFLICT`; no mutation |
| Missing/locked/category mismatch | Existing structured error; no mutation |
| Missing cutout asset | Accessible visual placeholder; Scene and tool operations continue |
| Cart request | Visible local approval sheet only; no network request |

## 13. Dependency and File Impact

Remove:

- `three`
- `@react-three/fiber`
- `@react-three/drei`
- `scene-canvas.tsx`
- `scene-object.tsx`
- `transform-gizmo.tsx`

Add or replace:

- `RoomPhotoStage` and focused cutout-layer components
- pure projection/calibration and asset-registry modules
- expanded deterministic catalog and static assets
- serializable Core 6 manifest
- page relay hook and pairing UI
- local MCP companion script
- official MCP SDK dependency
- setup documentation and Claude configuration examples

No unrelated dependency upgrades are included.

## 14. Testing Strategy

### 14.1 Unit tests

- Projection and inverse projection at corners, center, room bounds, and clamped positions.
- Depth scale and stacking, including rug layer bias.
- Asset registry completeness for six seed and eighteen catalog objects.
- Missing-asset fallback.
- Pointer preview versus one command on release; cancellation produces zero commands.
- Locked object, selection clear, rotation, keyboard movement, undo, and reset.
- Expanded catalog deterministic search across every category/style family.
- Shared manifest parity across Zod, WebMCP, and MCP adapters.
- Pair code expiry/reuse, origin rejection, manifest mismatch, single-tab replacement, body limits, timeout, and disconnect.
- Existing Core 6 handler, stale-state, abort, lifecycle, and approval tests.
- Dependency assertions proving the 3D packages are absent.

### 14.2 Component and browser tests

- The demo renders an editable room photograph without WebGL.
- Exactly six old seed cutouts appear initially.
- Human drag commits one Scene move and undo restores the original photo placement.
- A captured native WebMCP journey replaces a seed object with the second search result exactly once.
- A stale move leaves both Scene data and cutout position unchanged.
- A whole-room agent fixture can replace all six categories sequentially using only Core 6.
- Cart approval includes only replaced product-backed objects and makes zero external requests.
- Native registration cleanup still aborts all six registrations on navigation.
- Companion integration uses a real MCP client against the stdio process, pairs a test page, lists exact Core 6, executes a read and mutation, and verifies disconnect behavior.
- Existing human cart and non-agent navigation journeys remain green.

### 14.3 Full verification

The final branch must pass:

1. unit/component tests,
2. Chromium E2E,
3. typecheck,
4. lint,
5. vinext build,
6. Next.js webpack build,
7. dependency and static-asset checks,
8. `git diff --check`.

## 15. Acceptance Criteria

- The demo contains no WebGL canvas and no installed Three.js/R3F/Drei packages.
- The initial room visibly contains six mismatched old cutouts over a fixed room photograph.
- Every cutout corresponds to the canonical Scene object and can be selected without an agent.
- Dragging an unlocked cutout commits exactly one existing command; undo restores it.
- All eighteen catalog products have local transparent cutouts and are searchable in stable order.
- A whole-room prompt can be satisfied by a ChatGPT WebMCP agent using only Core 6 calls.
- Claude Desktop and Claude Code can list and execute the exact same Core 6 through the paired localhost companion.
- WebMCP and MCP calls mutate the one live browser Scene, never a copied companion state.
- Stale, locked, missing, mismatched, aborted, disconnected, and unpaired calls fail without unintended mutation.
- Cart remains an approval-only local UI with zero external writes.
- The page remains fully usable when both native WebMCP and the companion are absent.
- All verification commands pass on the completed branch.
