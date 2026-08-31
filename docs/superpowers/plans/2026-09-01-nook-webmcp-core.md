# Nook WebMCP Core 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register six validated WebMCP tools that read and mutate Nook's shared Scene state and open a local cart approval draft without an external write.

**Architecture:** Pure WebMCP contract and handler modules sit above the existing Scene store command layer. A feature-detected React hook registers same-origin tools with one `AbortController`, while `DemoWorkspace` supplies a late-bound `ToolContext` and renders any cart draft through the existing approval sheet.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript 5, Zod 4.5.4, Zustand 5.0.15, Chrome WebMCP Imperative API, Vitest, React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-01-nook-webmcp-core-spec.md`

## Global Constraints

- Use the existing validated Scene JSON and `SceneStoreState.applyCommand`; do not create a second Agent state or mutate Three.js objects.
- Feature-detect `document.modelContext`; unsupported browsers retain the complete human UI with no error.
- Register exactly `get_scene`, `get_selection`, `search_products`, `replace_object`, `move_object`, and `add_scene_to_cart`.
- Unregister with the current API's registration `AbortSignal`; do not invent `unregisterTool()`.
- Match the execution callback `(input, { signal })` and abort before reads or side effects.
- Validate every input with strict Zod and a narrow JSON Schema with `additionalProperties: false`.
- Return the shared MCP-style `ToolResult` containing text `content` and a typed `structuredContent` success/error envelope.
- Handle no selection, stale revision, missing object, locked object, category mismatch, missing product, and an empty cart draft without arbitrary mutation.
- Treat demo product text as untrusted and annotate every tool accurately.
- Preserve Scene revision semantics while using a monotonic Zustand
  `stateVersion` concurrency token for every mutation.
- `add_scene_to_cart` opens approval UI only and performs no external cart or network write.
- Keep the existing four-item `$626 USD` human cart flow unchanged.
- Add no dependency and do not change `pnpm-lock.yaml`.
- Do not implement a generic `execute` tool, Shopify, Tripo, R2, D1, uploads, or deployment.

---

### Task 1: Shared Results, Contracts, and Eval Manifest

**Files:**
- Create: `src/webmcp/tool-result.ts`
- Create: `src/webmcp/tool-contracts.ts`
- Create: `tests/unit/tool-contracts.test.ts`
- Create: `tests/evals/webmcp-journeys.json`

**Interfaces:**
- Consumes: Zod and the existing `ProductCategorySchema` and `SceneCommandErrorCode` types.
- Produces: `CORE_TOOL_NAMES`, `CoreToolName`, the six strict input Zod schemas and JSON Schema constants, `ToolErrorCode`, `ToolResult<T>`, `toolSuccess()`, `toolError()`, and `invalidInputResult()`.

- [ ] **Step 1: Write contract tests first**

Create table-driven tests that assert:

```ts
expect(CORE_TOOL_NAMES).toEqual([
  "get_scene",
  "get_selection",
  "search_products",
  "replace_object",
  "move_object",
  "add_scene_to_cart",
]);
expect(getSceneInputSchema.safeParse({ extra: true }).success).toBe(false);
expect(searchProductsInputSchema.safeParse({ limit: 0 }).success).toBe(false);
expect(moveObjectInputSchema.safeParse({
  expectedRevision: 1,
  expectedStateVersion: 1,
  position: { x: 21, z: 0 },
}).success).toBe(false);
expect(MOVE_OBJECT_JSON_SCHEMA.additionalProperties).toBe(false);
expect(MOVE_OBJECT_JSON_SCHEMA.properties.position.additionalProperties).toBe(false);
```

Also assert that success has `isError === undefined`, error has
`isError === true`, both have one text content item, and their
`structuredContent` branches contain the tool name, Scene revision, and
monotonic state version. Import `tests/evals/webmcp-journeys.json` and assert
the static manifest contains the three named
journeys `replace-second-result`, `stale-move-conflict`, and
`cart-approval-only`.

- [ ] **Step 2: Run the targeted test and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/tool-contracts.test.ts
```

Expected: FAIL because `src/webmcp/tool-result.ts`,
`src/webmcp/tool-contracts.ts`, and the static eval manifest do not exist.

- [ ] **Step 3: Implement the result envelope**

Define `ToolResult<T>` exactly as the spec, with error issues normalized to
`{ path: string; message: string }`. `toolSuccess()` and `toolError()` create a
single concise text content entry and never echo raw input. `invalidInputResult()`
accepts a `ZodError`, uses `issue.path.join(".") || "input"`, and returns
`INVALID_INPUT` with `retryable: true`.

- [ ] **Step 4: Implement strict input contracts**

Use these bounds in both Zod and JSON Schema:

```ts
const objectId = z.string().max(64).trim().min(1);
const productId = z.string().max(80).trim().min(1);
const query = z.string().max(80).trim().min(1).optional();
const expectedRevision = z.number().int().min(1);
const expectedStateVersion = z.number().int().min(1);
const coordinate = z.number().finite().min(-20).max(20);
const rotationYDegrees = z.number().finite().min(-360).max(360).optional();
const limit = z.number().int().min(1).max(3).default(3);
```

`search_products` accepts optional `category`, `query`, and `limit`.
`replace_object` requires `productId`, `expectedRevision`, and
`expectedStateVersion` with optional `objectId`. `move_object` requires
`position`, `expectedRevision`, and `expectedStateVersion` with optional
`objectId` and rotation. `add_scene_to_cart` requires `expectedRevision` plus
`expectedStateVersion` and accepts `objectIds` as a unique `1..20` item array.
Empty-input schemas are strict empty objects.

- [ ] **Step 5: Add the static eval manifest**

Record three non-executable JSON manifest objects with `id`, `prompt`, `expectedTools`, and
`assertions`. The replace journey prompt is “Replace this table with the second
result” and requires one revision increment; the move journey requires a stale
revision conflict and no mutation; the cart journey requires a visible approval
dialog and zero external requests.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/tool-contracts.test.ts
pnpm run typecheck
git diff --check
```

Commit only these task files with:

```bash
git add src/webmcp/tool-result.ts src/webmcp/tool-contracts.ts tests/unit/tool-contracts.test.ts tests/evals/webmcp-journeys.json
git commit -m "feat(webmcp): define Core 6 tool contracts"
```

---

### Task 2: Deterministic Core 6 Handlers

**Files:**
- Create: `src/webmcp/tool-context.ts`
- Create: `src/webmcp/tool-handlers.ts`
- Create: `tests/unit/webmcp-tools.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts/results, existing `Scene`, `SceneObject`, `SceneProduct`, `CommandRequest`, and `CommandResult`.
- Produces: `CatalogProduct`, `CartApprovalDraft`, `CartApprovalItem`, `ToolContext`, `ModelContextTool`, and `createCoreTools(context): readonly ModelContextTool[]`.

- [ ] **Step 1: Write handler tests against a real Scene store**

Build a `ToolContext` around `createSceneStore()` and the real three
`DEMO_PRODUCTS`. Capture approval drafts in a local array. Execute descriptors
by exact name and assert:

```ts
const search = await execute("search_products", { category: "coffee_table" });
expect(search.structuredContent.data.results[1].id)
  .toBe("travertine-plinth-table");

const replace = await execute("replace_object", {
  productId: "travertine-plinth-table",
  expectedRevision: 1,
  expectedStateVersion: 1,
});
expect(replace.structuredContent.ok).toBe(true);
expect(store.getState().scene.revision).toBe(2);
expect(store.getState().scene.objects.find(({ id }) => id === "table_01")
  ?.product?.id).toBe("travertine-plinth-table");

const staleMove = await execute("move_object", {
  objectId: "lamp_01",
  expectedRevision: 1,
  expectedStateVersion: 2,
  position: { x: 0, z: 0 },
});
expect(staleMove.structuredContent.error).toMatchObject({
  code: "SCENE_REVISION_CONFLICT",
  latestRevision: 2,
});
expect(store.getState().scene.revision).toBe(2);
```

Add independent tests for malformed input, no selection, missing product,
missing object, locked object, category mismatch, empty cart, explicit cart
object IDs, annotation values, and all output envelopes. Spy on `globalThis.fetch`
during `add_scene_to_cart` and assert it is not called. Also prove revision ABA
and selection changes conflict through `stateVersion`, catalog data is parsed
and cloned, and aborted executions perform no command or approval callback.

- [ ] **Step 2: Run the handler test and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/webmcp-tools.test.ts
```

Expected: FAIL because the context and handler modules do not exist.

- [ ] **Step 3: Implement the late-bound context types**

Define:

```ts
interface ToolContext {
  getScene(): Scene;
  getStateVersion(): number;
  getSelection(): SceneObject | null;
  searchProducts(input: SearchProductsInput): readonly CatalogProduct[];
  resolveProduct(productId: string): CatalogProduct | undefined;
  applyCommand(request: CommandRequest): CommandResult;
  openCartApproval(draft: CartApprovalDraft): void;
}
```

`CatalogProduct` extends the validated Scene product metadata with a bounded
description. Handlers parse and clone search/resolution results through its Zod
schema and return `CATALOG_DATA_INVALID` for malformed data. A cart item contains `objectId`, `productId`, `variantId`, `title`,
quantity `1`, and the USD price. A draft ID is
`scene-${scene.id}-rev-${scene.revision}` and includes `sceneId`,
`sceneRevision`, items, and `totalMinor`.

- [ ] **Step 4: Implement thin handlers**

For every descriptor, call `signal.throwIfAborted()`, then parse input with its
Task 1 Zod schema before mutating state. `get_scene` returns
`SceneSchema.parse(context.getScene())`.
`get_selection` returns `NO_SELECTION` if null. Search delegates to the context
and preserves returned order.

Replacement and movement resolve an omitted object ID from selection, then call
`context.applyCommand()` once with `actor: "agent"`. Map command errors without
changing their codes or retryability; include `latestRevision` for revision
conflicts. All mutations compare the monotonic `expectedStateVersion` before
selection-dependent work; cart also compares `expectedRevision`, resolves explicit IDs or all
product-backed non-seed objects, rejects missing objects and empty drafts, calls
`openCartApproval()` once, and does not call `fetch`.

- [ ] **Step 5: Apply exact security annotations**

Use the annotation matrix from the spec. Every descriptor carries
`untrustedContentHint: true` because catalog titles/descriptions can flow into
later Scene, selection, move, and cart output. Only the three read/search tools
use `readOnlyHint: true`.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/tool-contracts.test.ts tests/unit/webmcp-tools.test.ts
pnpm run typecheck
git diff --check
```

Commit only these task files with:

```bash
git add src/webmcp/tool-context.ts src/webmcp/tool-handlers.ts tests/unit/webmcp-tools.test.ts
git commit -m "feat(webmcp): implement Scene Core 6 handlers"
```

---

### Task 3: Registration and React Lifecycle

**Files:**
- Create: `src/webmcp/register-tools.ts`
- Create: `src/webmcp/use-webmcp-tools.ts`
- Create: `tests/unit/register-tools.test.tsx`

**Interfaces:**
- Consumes: `ToolContext`, `ModelContextTool`, and `createCoreTools()` from Task 2.
- Produces: `ModelContext`, `WebMcpRegistration`, `registerWebMcpTools()`, `getDocumentModelContext()`, and `useWebMcpTools(context)`.

- [ ] **Step 1: Write lifecycle tests**

Create a fake `ModelContext` that rejects duplicate active names and removes a
name when the corresponding registration signal aborts. Assert:

```ts
const registration = registerWebMcpTools(modelContext, context);
await registration.ready;
expect([...modelContext.activeNames]).toEqual(CORE_TOOL_NAMES);
expect(modelContext.registrations).toHaveLength(6);
registration.unregister();
expect(modelContext.activeNames.size).toBe(0);
expect(modelContext.registrations.every(({ signal }) => signal.aborted))
  .toBe(true);
```

Add a registration-failure test proving the shared controller aborts all tools.
Render a harness using `useWebMcpTools()` with and without
`document.modelContext`; assert one registration set across rerenders and all
signals aborted on unmount. Ensure rejected registration does not log after an
intentional unmount.

- [ ] **Step 2: Run lifecycle tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/register-tools.test.tsx
```

Expected: FAIL because registration and hook modules do not exist.

- [ ] **Step 3: Implement current API types and registration**

Mirror only the current spec surface used by Nook:

```ts
interface ModelContextToolExecutionOptions {
  signal: AbortSignal;
}

interface ModelContextTool {
  execute(
    input: unknown,
    options: ModelContextToolExecutionOptions,
  ): Promise<ToolResult<unknown>>;
}

interface ModelContext {
  registerTool(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal; exposedTo?: readonly string[] },
  ): Promise<void>;
}
```

`registerWebMcpTools()` creates one `AbortController`, calls `registerTool()`
for all six descriptors with `{ signal: controller.signal }` and no
`exposedTo`, exposes `ready: Promise<void>`, and aborts on any registration
failure. `unregister()` is idempotent and aborts the controller.

- [ ] **Step 4: Implement feature detection and the hook**

`getDocumentModelContext()` returns null during SSR, when
`"modelContext" in document` is false, or when `registerTool` is not a function.
`useWebMcpTools(context)` registers in an effect, reports a non-abort
registration rejection once with `console.error`, and unregisters during effect
cleanup. It performs no state subscription and receives a stable context from
its caller.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/register-tools.test.tsx tests/unit/webmcp-tools.test.ts tests/unit/tool-contracts.test.ts
pnpm run typecheck
pnpm run lint
git diff --check
```

Commit only these task files with:

```bash
git add src/webmcp/register-tools.ts src/webmcp/use-webmcp-tools.ts tests/unit/register-tools.test.tsx
git commit -m "feat(webmcp): manage tool registration lifecycle"
```

---

### Task 4: Demo Context, Cart Approval, and Browser Journey

**Files:**
- Modify: `src/features/demo/demo-types.ts`
- Modify: `src/features/demo/demo-state.ts`
- Modify: `src/features/demo/demo-workspace.tsx`
- Modify: `src/features/demo/cart-approval-sheet.tsx`
- Modify: `tests/unit/demo-state.test.ts`
- Modify: `tests/unit/demo-workspace.test.tsx`
- Create: `tests/e2e/webmcp-core.spec.ts`
- Modify: `README.md`
- Modify: `docs/NEXT_SESSION.md`

**Interfaces:**
- Consumes: `useWebMcpTools`, `ToolContext`, `CartApprovalDraft`, existing `SceneStore`, `DEMO_PRODUCTS`, and existing demo reducer/UI.
- Produces: a stable demo `ToolContext`, optional cart draft state, draft-aware approval rendering, and an end-to-end WebMCP Core 6 journey.

- [ ] **Step 1: Write component RED tests**

Install a fake `document.modelContext`, render `DemoWorkspace`, await exactly six
captured tools, execute `search_products`, then execute `replace_object` with
the second result, revision `1`, and state version `1`. Assert Scene diagnostics become
`Revision 2 · table_01 · travertine-plinth-table`.

Execute `add_scene_to_cart` with revision/state version `2`, assert the visible approval
dialog lists one Travertine Plinth Table at `$249 USD`, and assert a fetch spy
has no calls. Unmount and assert all registration signals are aborted. Add a
reducer test proving close, confirm, and reset clear an agent cart draft while
the ordinary `open-cart` action retains the existing fixture mode.

- [ ] **Step 2: Run component tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/demo-state.test.ts tests/unit/demo-workspace.test.tsx
```

Expected: FAIL because the workspace does not register tools or store/render a
WebMCP cart draft.

- [ ] **Step 3: Wire the stable ToolContext**

Create the context with `useMemo([sceneStore])`. Every function reads
`sceneStore.getState()` at call time, including `getStateVersion`. Search filters the existing
`DEMO_PRODUCTS` by optional exact category and case-insensitive query across
title, description, style tags, color, and material, then applies `limit` while
preserving catalog order. Product resolution looks up the same array.
`applyCommand` delegates to the current store action. `openCartApproval`
dispatches `{ type: "open-cart", draft }`. Call `useWebMcpTools(context)` once.

- [ ] **Step 4: Make cart UI optionally draft-aware**

Add `cartDraft: CartApprovalDraft | null` to `DemoState` and optional `draft` to
`open-cart`. The existing header dispatch has no draft and therefore still
renders `CART_ITEMS`, four rows, `$626 USD`, and its existing labels. A WebMCP
draft renders its own items and total, identifies the Scene revision in the
intro, and still labels the sheet “Approval required”. Close, confirm, and reset
clear the draft. Neither path adds a network call.

- [ ] **Step 5: Add browser-level RED then GREEN evidence**

Create a Playwright init script that defines `document.modelContext` before
navigation. Its fake `registerTool()` stores exact descriptors on `window` and
removes them when the registration signal aborts. The test executes:

1. `get_selection` at revision/state version `1`;
2. `search_products({ category: "coffee_table" })`;
3. `replace_object` with result index `1`, revision `1`, and state version `1`;
4. a stale `move_object` with revision `1`, state version `2`, and verifies the latest revision is
   `2` and diagnostics did not change;
5. `add_scene_to_cart({ expectedRevision: 2, expectedStateVersion: 2 })` and verifies approval UI;
6. navigation to `/` and verifies the captured active tool set is empty.

After `/demo` is loaded, wrap `window.fetch` with a counter and track external
browser requests before the cart tool call; assert both stay empty. Also assert
no application console errors.

Run once before Steps 3-4 to capture the expected failure, then again after
implementation:

```bash
pnpm exec playwright test tests/e2e/webmcp-core.spec.ts --config=playwright.config.ts
```

- [ ] **Step 6: Update project status docs**

Update README status to say WebMCP Core 6 is a progressive enhancement backed
by the shared Scene store and that cart calls remain approval-only. Replace the
old Scene Core handoff in `docs/NEXT_SESSION.md` with the branch, commit, RED /
GREEN evidence, verification matrix, residual warnings, and next packages;
state explicitly that merge, push, and deploy were not performed.

- [ ] **Step 7: Run the full verification matrix**

Run in order and stop on the first failure:

```bash
pnpm run test
pnpm run test:e2e
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run build:next
git diff --check
```

- [ ] **Step 8: Review and commit**

Review `git diff`, verify `pnpm-lock.yaml` is unchanged and no generic execute
tool or external integration entered the diff, then commit the Task 4 files and
the spec/plan documents with:

```bash
git add README.md docs/NEXT_SESSION.md src/features/demo/demo-types.ts src/features/demo/demo-state.ts src/features/demo/demo-workspace.tsx src/features/demo/cart-approval-sheet.tsx tests/unit/demo-state.test.ts tests/unit/demo-workspace.test.tsx tests/e2e/webmcp-core.spec.ts
git commit -m "feat(demo): connect WebMCP to cart approval"
```
