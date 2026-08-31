# Nook Next Session Handoff

Snapshot: 2026-09-01 KST. The final review repair is identified by the exact
commit subject `fix(webmcp): harden execution and stale-state safety`; its SHA
is intentionally not self-referenced from inside that commit.

## Current State

- Feature branch: `feat/webmcp-core`
- Worktree: `/Users/taehun/Projects/WebMCP/.worktrees/webmcp-core`
- Base branch: `main` at `454f007cf623c112a2cbb54093683e5f90faddfd`
- WebMCP Core 6 is a feature-detected progressive enhancement. The complete
  human demo still works when `document.modelContext` is absent.
- All six tools use the same late-bound Scene store as the human UI. Replacement
  and movement remain revision-aware. A monotonic `stateVersion` increments for
  actual selection changes, successful commands, undo, and reset, preventing
  revision ABA and selection-target races without changing Scene JSON or the
  command layer. Cart calls only open visible local approval state.
- Tool execution matches `(input, { signal })` and aborts before any read or
  side effect. Catalog results are Zod-parsed/cloned, and all Core 6 descriptors
  conservatively mark possible catalog-derived output as untrusted.
- The four-item human fixture cart remains `$626 USD`; the optional WebMCP draft
  renders only eligible Scene products and remains UI-only.
- Merge, push, pull request creation, deployment, and external provider calls
  were not performed.

## Known Commit Chain

Scene Core and branch preparation:

- `b6a82d88ea45fd0231230715416d0687efdefdc3` — `docs: plan deterministic scene core`
- `ac9b815b17ba1c551dc213962dea9e054e1ef9e3` — `feat(scene): add deterministic room and command core`
- `649cca65bc205b4b53f2c8ad894065ef0eea51a4` — `feat(scene): add shared Zustand command store`
- `299da6d78e544e81f0c0e2afe41ee98da00eea80` — `feat(demo): connect the workspace to shared Scene state`
- `b2d5a981fdba0e68ee4394de9266120e7ac1503c` — `feat(scene): render and edit the deterministic room in R3F`
- `55b0f9c8e06e7e945e7ab0afbbede37545db8476` — `fix(scene): keep selection stable through undo`
- `70e7a35aa93bee75220760dfe0c34a542c9d0de6` — `docs: record Scene Core handoff`
- `454f007cf623c112a2cbb54093683e5f90faddfd` — `chore: exclude linked worktrees from lint`

WebMCP Core 6 before Task 4:

- `120940748a81608190949930ea63449af84bfe46` — `docs: plan Nook WebMCP Core 6`
- `71308c060a0166557709d001eadb17c84f376566` — `feat(webmcp): define Core 6 tool contracts`
- `f8a82ebf20233aed348b2414e1a7a82383ea92e8` — `fix(webmcp): align JSON text contracts`
- `6b46fe477b051d8ebc3801433154a009f669f98a` — `feat(webmcp): implement Scene Core 6 handlers`
- `5a16b6b084743c5403a35719ff82c4057ee4fe13` — `fix(webmcp): exclude placeholders from cart drafts`
- `0bde1521aa03ba3a29d61a6e61d795caa0645bf0` — `feat(webmcp): manage tool registration lifecycle`

## Task 4 RED / GREEN Evidence

Component command:

```bash
pnpm exec vitest run tests/unit/demo-state.test.ts tests/unit/demo-workspace.test.tsx
```

- RED: exit `1`; 2 files failed, with 3 failed and 12 passed tests. The initial
  reducer state lacked `cartDraft`, an agent draft was not retained, and the
  rendered workspace captured 0 rather than 6 tool registrations.
- GREEN: exit `0`; 2 files passed and all 15 tests passed.

Browser command:

```bash
pnpm exec playwright test tests/e2e/webmcp-core.spec.ts --config=playwright.config.ts
```

- RED: exit `1`; 1 test failed because the pre-implementation workspace
  registered 0 rather than 6 tools.
- GREEN: exit `0`; 1 Chromium test passed. It executed the captured descriptors,
  proved the stale move left revision 2 unchanged, counted zero fetch calls, and
  used the `Nook home` Next Link to prove every active registration aborted.

## Final Review Repair RED / GREEN Evidence

Targeted command:

```bash
pnpm exec vitest run tests/unit/tool-contracts.test.ts tests/unit/scene-store.test.ts tests/unit/webmcp-tools.test.ts tests/unit/demo-workspace.test.tsx
```

- RED: exit `1`; 4 files failed with 30 failed and 19 passed tests. Failures
  specifically showed missing `stateVersion`, raw padded strings accepted,
  direct `AbortSignal` callback behavior, unparsed catalog data, stale ABA /
  selection races, and incomplete untrusted annotations.
- GREEN: exit `0`; all 4 files and 49 tests passed.
- The handler journey spies `applyCommand` and proves the second-result
  replacement invokes exactly one command. Abort tests prove zero mutation and
  zero approval callbacks.

## Verification Matrix

The required commands ran in this exact order and exited `0`:

1. `pnpm run test` — 10 files passed; 69 tests passed.
2. `pnpm run test:e2e` — 3 Chromium tests passed.
3. `pnpm run typecheck` — TypeScript completed with no diagnostics.
4. `pnpm run lint` — ESLint completed with no diagnostics.
5. `pnpm run build` — vinext completed all five build phases and emitted `/`
   and `/demo`.
6. `pnpm run build:next` — Next.js 16.3.3 compiled, type-checked, and generated
   4/4 static pages; `/` and `/demo` are static.
7. `git diff --check` — clean.

The updated E2E journey uses the official `{ signal }` execution options,
carries `expectedStateVersion`, and records both zero fetch calls and zero
cross-origin browser requests during dynamic cart approval.

## Known Residuals

- Three/drei emits the upstream `THREE.Clock` deprecation warning during browser
  runs; the WebMCP journey records zero application console errors.
- Playwright/Next dev emits `NO_COLOR` / `FORCE_COLOR` process warnings.
- vinext reports a client chunk larger than 500 kB because of the 3D stack.
- vinext's Node process also emits the upstream `punycode` deprecation warning.
- The WebMCP API is still experimental and browser-gated; unsupported browsers
  intentionally run the unchanged human path.
- No generic execute tool, Shopify/Tripo/R2/D1 integration, upload, persistence,
  external request, or deployment is part of this package.

## Next Work Packages

1. Integrate `feat/webmcp-core` through the chosen local merge or pull-request
   workflow, then rerun the full matrix on the integrated result.
2. Implement `CommerceProvider`, `DemoProvider`, and `ShopifyProvider` with an
   explicitly approved server cart route; keep `DemoProvider` deterministic.
3. Add cached product assets and R2/D1 bindings, then the optional Tripo
   live-generation showcase.
4. Add room upload and analysis only after the shared Scene, WebMCP, and
   commerce journey remains green.
