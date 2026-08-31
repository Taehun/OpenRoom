# Nook WebMCP Core 6 Specification

## Outcome

Expose the Nook `/demo` Scene to WebMCP-aware browser agents through six
single-purpose tools while keeping the human UI primary. Agent reads and
mutations use the same validated Scene JSON, Zustand store, and revision-aware
command layer as direct human interactions.

## Current WebMCP API Contract

This work targets the Chrome WebMCP Imperative API documented on 2026-09-01.

- Feature-detect `document.modelContext`; browsers without it keep the complete
  human editing experience and emit no registration error.
- Register a `ModelContextTool` with `document.modelContext.registerTool()`.
- Pass an `AbortSignal` in the registration options and abort it to unregister
  the tool. There is no separate `unregisterTool()` method in the current API.
- Accept the official execution callback shape `(input, { signal })` and call
  `signal.throwIfAborted()` before any read callback or side effect.
- Do not set `exposedTo`; Core 6 tools remain same-origin by default.
- Return a serializable result with a concise MCP-style text `content` entry and
  a machine-readable `structuredContent` success/error envelope.

## Core 6 Tools

| Tool | Input | Effect | Annotations |
| --- | --- | --- | --- |
| `get_scene` | strict empty object | Return the current validated Scene JSON | `readOnlyHint: true`, `untrustedContentHint: true` |
| `get_selection` | strict empty object | Return the selected Scene object or `NO_SELECTION` | `readOnlyHint: true`, `untrustedContentHint: true` |
| `search_products` | optional category/query and limit `1..3` | Search the deterministic local demo catalog in stable catalog order | `readOnlyHint: true`, `untrustedContentHint: true` |
| `replace_object` | optional object ID, product ID, expected revision and state version | Replace the explicit or selected object through `applyCommand` | `readOnlyHint: false`, `untrustedContentHint: true` |
| `move_object` | optional object ID, X/Z position, optional Y rotation, expected revision and state version | Move the explicit or selected object through `applyCommand` | `readOnlyHint: false`, `untrustedContentHint: true` |
| `add_scene_to_cart` | expected revision/state version and optional object IDs | Build a local draft from product-backed, non-seed Scene objects and open the visible approval sheet | `readOnlyHint: false`, `untrustedContentHint: true` |

Every input JSON Schema uses `type: "object"` and
`additionalProperties: false`. Runtime handlers independently parse the same
input with strict Zod schemas; browser schema enforcement is not trusted as the
only validation layer.

`objectId` is optional for selection-oriented mutation tools. When omitted, the
current Scene selection is used. An absent selection returns `NO_SELECTION`
without mutation. `search_products` returns the three table fixtures in the
existing `DEMO_PRODUCTS` order when no filter removes them, so “the second
result” resolves deterministically to `travertine-plinth-table`.

Every mutation also requires `expectedStateVersion`. The Zustand store starts
this monotonic token at `1` and increments it for an actual selection change,
successful command, undo, and reset. It never rolls back with Scene revision,
so a revision ABA or omitted-target selection race returns
`SCENE_REVISION_CONFLICT` before mutation.

## Shared Result Contract

Every tool returns `ToolResult<T>`:

```ts
interface ToolResult<T> {
  content: [{ type: "text"; text: string }];
  structuredContent:
    | {
        ok: true;
        tool: CoreToolName;
        sceneRevision: number;
        stateVersion: number;
        data: T;
      }
    | {
        ok: false;
        tool: CoreToolName;
        sceneRevision: number;
        stateVersion: number;
        error: {
          code: ToolErrorCode;
          message: string;
          retryable: boolean;
          latestRevision?: number;
          latestStateVersion?: number;
          issues?: Array<{ path: string; message: string }>;
        };
      };
  isError?: true;
}
```

Errors are structured and actionable: `INVALID_INPUT`, `NO_SELECTION`,
`PRODUCT_NOT_FOUND`, `CATALOG_DATA_INVALID`, `NO_CART_ITEMS`, plus the existing command-layer
`OBJECT_NOT_FOUND`, `OBJECT_LOCKED`, `CATEGORY_MISMATCH`, and
`SCENE_REVISION_CONFLICT`. A conflict includes the current revision and state
version and never mutates Scene state.

## Architecture and State Boundaries

- `ToolContext` provides late-bound Scene reads, selection lookup, product
  search/resolution, the monotonic state version, command application, and an
  approval-sheet callback.
- Tool handlers do not import React components and never mutate Three.js
  objects.
- `replace_object` and `move_object` call the existing Scene store
  `applyCommand()` exactly once per invocation with `actor: "agent"` and the
  caller's `expectedRevision`, after checking `expectedStateVersion`.
- Product fixtures are parsed and cloned through `CatalogProductSchema` before
  output or command application. Malformed catalog data returns a structured
  error. Because catalog text can later appear in Scene, selection, move, and
  cart output, every Core 6 descriptor carries `untrustedContentHint: true`.
  Schemas bound raw string lengths before trimming, and errors never echo
  arbitrary input values.
- One stable React hook registration lives inside the existing client-side
  Scene provider boundary. It registers the exact Core 6 once for that mount and
  aborts the shared registration controller during unmount or route change.

## Cart Approval Contract

`add_scene_to_cart` cannot write to Shopify or any other external cart. It
selects product-backed Scene objects whose `addedBy` is `human` or `agent`, or
the caller's explicit product-backed object IDs, and builds a deterministic
draft with quantity one per object. It opens the existing modal approval sheet
with those draft items. The existing human “View cart” journey remains the
four-item `$626 USD` fixture. Confirming either sheet remains UI-only and makes
no `fetch` or external request.

## Verification

- Unit tests prove the exact six names, narrow JSON Schemas, strict Zod parsing,
  annotation values, structured result shape, handler errors, registration
  uniqueness, failure rollback, and abort cleanup.
- A real-store journey searches, replaces the selected table with the second
  result, and observes exactly one `applyCommand` call and revision increment.
- A stale move returns `SCENE_REVISION_CONFLICT` with the latest revision and no
  mutation.
- ABA and selection-change tests prove a stale state version cannot target a
  restored revision or newly selected object.
- Aborted executions reject before Scene mutation or approval callbacks.
- Component and Playwright journeys execute captured WebMCP descriptors, open
  the approval UI, record no external request, and prove cleanup on navigation.
- Existing human selection, transforms, preview, Agent move, undo, reset, and
  cart tests remain green.
- `tests/evals/webmcp-journeys.json` is a static eval manifest used to record
  prompts and assertions; executable behavior is covered by unit/component/E2E
  suites.
- `pnpm run test`, `pnpm run test:e2e`, `pnpm run typecheck`, `pnpm run lint`,
  `pnpm run build`, `pnpm run build:next`, and `git diff --check` exit `0`.

## Out of Scope

No dependency upgrade, generic `execute` tool, Shopify provider, external cart
write, Tripo generation, R2, D1, upload analysis, or deployment is included.
