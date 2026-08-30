# Nook Next.js UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Nook Spatial Atelier design as an interactive, deterministic Next.js `/demo` UI at the supported 1280×720 desktop viewport.

**Architecture:** Keep routes and metadata server-rendered while a focused `DemoWorkspace` client boundary owns the temporary UI-only reducer. Fixtures and transitions stay in pure TypeScript, visual regions are split into small components, and a CSS module carries the approved design tokens and responsive rules. The implementation deliberately stops before R3F, WebMCP, and external provider behavior.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules, `next/font`, `next/image`, Vitest, React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-nook-nextjs-ui-design.md`

## Global Constraints

- Supported editor viewport is desktop Chrome at a minimum of `1280 × 720`; mobile editing is out of scope.
- Use approved Spatial Atelier colors: limestone `#F2EFE8`, paper `#FBFAF6`, divider `#D8D2C7`, ink `#242722`, moss `#5E6B4E`, terracotta `#C8784E`.
- Use Newsreader headings and DM Sans UI text through `next/font/google`.
- `/demo` must be deterministic, require no external API, and reset to revision `1`.
- Product results are exactly three; the approval sheet contains exactly four items totaling `$626 USD`.
- `Continue to Shopify` performs no external request in this UI-only work package.
- Human UI mutations use the pure `demoReducer`; later scene work replaces it with the shared Zustand command layer.
- Primary actions remain at least `44px` high and status never relies on color alone.
- Avoid purple gradients, glassmorphism, generic dashboard card grids, decorative blobs, and uniformly oversized radii.
- Do not add or upgrade dependencies; preserve the current lockfile.

---

### Task 1: Design Foundation and Deterministic Demo State

**Files:**
- Create: `src/features/demo/demo-types.ts`
- Create: `src/features/demo/demo-data.ts`
- Create: `src/features/demo/demo-state.ts`
- Create: `tests/unit/demo-state.test.ts`
- Create: `public/demo/nook-room.png`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `DemoState`, `DemoAction`, `DemoProduct`, `createInitialDemoState(): DemoState`, `demoReducer(state: DemoState, action: DemoAction): DemoState`, `DEMO_PRODUCTS`, and `CART_ITEMS`.
- Consumes: no application interfaces beyond React/Next font configuration.

- [ ] **Step 1: Write failing reducer tests**

```ts
import { describe, expect, test } from "vitest";
import { createInitialDemoState, demoReducer } from "../../src/features/demo/demo-state";

describe("demoReducer", () => {
  test("previews the selected product as a reversible scene change", () => {
    const initial = createInitialDemoState();
    const products = demoReducer(initial, { type: "show-products" });
    const preview = demoReducer(products, {
      type: "preview-product",
      productId: "oak-frame-table",
    });

    expect(preview).toMatchObject({
      mode: "products",
      previewProductId: "oak-frame-table",
      provider: "Cached",
      revision: 2,
      roomTotalMinor: 16900,
    });
    expect(demoReducer(preview, { type: "undo" })).toMatchObject({
      mode: "products",
      previewProductId: null,
      revision: 1,
      roomTotalMinor: 0,
    });
  });

  test("records an agent move and reset returns the canonical revision", () => {
    const moved = demoReducer(createInitialDemoState(), {
      type: "run-agent-move",
    });
    expect(moved).toMatchObject({ mode: "activity", revision: 2 });
    expect(moved.toast?.message).toBe("Lamp moved to match your layout");
    expect(demoReducer(moved, { type: "reset" })).toEqual(
      createInitialDemoState(),
    );
  });
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `pnpm exec vitest run tests/unit/demo-state.test.ts`

Expected: FAIL because `demo-state` does not exist.

- [ ] **Step 3: Implement fixtures and reducer**

Implement the exact interfaces above. Keep a single previous reversible snapshot in
`history`; `show-products`, cart visibility, and selection do not increment revision.
`preview-product` and `run-agent-move` push a snapshot and increment revision once.
`DemoAction` must also include `open-cart`, `close-cart`, `confirm-demo-cart`, `undo`,
and `reset`. `confirm-demo-cart` closes the sheet and sets the announcement string
without changing revision or making a request. Return a newly-created canonical
object from `reset` so no mutable state is shared.

- [ ] **Step 4: Add self-hosted font variables and global tokens**

Configure `Newsreader` and `DM_Sans` in `app/layout.tsx` with CSS variables
`--font-editorial` and `--font-ui`. Replace the placeholder global palette with the
approved tokens, global focus styles, body defaults, and reduced-motion defaults.

- [ ] **Step 5: Add the bundled room image**

Create `public/demo/`, then download the approved Stitch room asset exactly once:

```bash
curl -sS -L -o public/demo/nook-room.png 'https://lh3.googleusercontent.com/aida/AEtjO1XOLpp5ciCufy70tTS2EKmr3xkWhfyYPYx7Eue24AtgzeyYJawczfc56tVW-WQL8b0Zes0lROTpRWvtMFRLPK9bT_Wl0eCk2P2k8n5onB0kqHYRyX0dZmJ_MLSHxvGj3toORIdHba8cuiTBH-VtEV6nhCmmx8TkSHZeRYylT_ywWZswfKFI64Wcj9Uv2gOU8tjHpO1ISaI1HZfHKo73vrVe_GF77usGZ-OpvFHPICgCWBKi9G_XL0mqSuw'
file public/demo/nook-room.png
```

Expected: a valid PNG or JPEG image payload, not HTML, and under 5MB.

- [ ] **Step 6: Run tests, typecheck, and commit**

Run:

```bash
pnpm exec vitest run tests/unit/demo-state.test.ts
pnpm run typecheck
```

Expected: all commands exit 0.

Commit: `feat(ui): add Nook design foundation and demo state`

### Task 2: Interactive Spatial Atelier Workspace

**Files:**
- Create: `app/demo/page.tsx`
- Create: `src/features/demo/demo-workspace.tsx`
- Create: `src/features/demo/demo-workspace.module.css`
- Create: `src/features/demo/workspace-header.tsx`
- Create: `src/features/demo/room-canvas.tsx`
- Create: `src/features/demo/context-panel.tsx`
- Create: `src/features/demo/cart-approval-sheet.tsx`
- Create: `src/features/demo/nook-icon.tsx`
- Create: `tests/unit/demo-workspace.test.tsx`

**Interfaces:**
- Consumes: `DemoState`, `DemoAction`, `createInitialDemoState`, `demoReducer`, `DEMO_PRODUCTS`, and `CART_ITEMS` from Task 1.
- Produces: `DemoWorkspace`, the `/demo` route, and user-visible transitions for products, preview, Agent activity, Undo, reset, and cart approval.

- [ ] **Step 1: Write failing workspace interaction tests**

```tsx
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { DemoWorkspace } from "../../src/features/demo/demo-workspace";

test("moves from object inspection to product preview", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  expect(screen.getByRole("heading", { name: "Object inspector" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Find alternatives" }));
  const products = screen.getByRole("region", { name: "Tables for your room" });
  expect(within(products).getAllByRole("article")).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Preview Oak Frame Table" }));
  expect(screen.getByText("Previewing Oak Frame Table")).toBeVisible();
});

test("opens a four-item approval sheet without creating a cart", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);
  await user.click(screen.getByRole("button", { name: "View cart" }));

  const sheet = screen.getByRole("dialog", { name: "Review your room" });
  expect(within(sheet).getAllByRole("listitem")).toHaveLength(4);
  expect(within(sheet).getByText("$626 USD")).toBeVisible();
  expect(
    within(sheet).getByRole("button", { name: "Continue to Shopify · $626" }),
  ).toBeVisible();
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `pnpm exec vitest run tests/unit/demo-workspace.test.tsx`

Expected: FAIL because `DemoWorkspace` does not exist.

- [ ] **Step 3: Implement the server route and client boundary**

`app/demo/page.tsx` renders metadata and `DemoWorkspace`. `DemoWorkspace` uses
`useReducer(demoReducer, undefined, createInitialDemoState)`, installs one keyboard
listener for Escape and Cmd/Ctrl+Z, and passes state/action callbacks to focused
children. No component fetches data or imports provider modules.

- [ ] **Step 4: Implement the workspace shell**

Match the approved layout: 64px header, 72px tool rail, dominant room image,
360px context panel, and 72px composer. Keep semantic buttons and regions. The
selected coffee table uses a moss outline plus text label; the accessible object
list includes sofa, coffee table, rug, floor lamp, chair, and plant.

- [ ] **Step 5: Implement all four context states**

Render inspector, exactly three products, Agent activity, and the cart approval
dialog from pure fixtures. Preserve the room shell behind the 500px cart sheet.
`Continue to Shopify` dispatches `confirm-demo-cart`, closes the dialog, and announces
`Demo only — no external cart was created.` through an `aria-live` region.

- [ ] **Step 6: Run unit tests, typecheck, and commit**

Run:

```bash
pnpm exec vitest run tests/unit/demo-state.test.ts tests/unit/demo-workspace.test.tsx
pnpm run typecheck
```

Expected: all commands exit 0.

Commit: `feat(ui): implement interactive spatial commerce workspace`

### Task 3: Landing Integration, Accessibility, and Browser Verification

**Files:**
- Modify: `app/page.tsx`
- Modify: `src/features/demo/demo-workspace.module.css`
- Modify: `tests/unit/home-shell.test.tsx`
- Modify: `tests/e2e/home-shell.spec.ts`
- Create: `tests/e2e/demo-workspace.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the `/demo` route and `DemoWorkspace` from Task 2.
- Produces: the public landing entry, 1280×720 E2E proof, keyboard behavior coverage, and accurate documentation of the UI-only demo boundary.

- [ ] **Step 1: Update tests first for the live demo entry**

Change the home unit and E2E expectations from `Deterministic demo coming soon` to
`Open deterministic demo`. Add the demo E2E journey:

```ts
test("completes the deterministic spatial commerce UI journey", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/demo");

  await expect(page.getByRole("heading", { name: "Object inspector" })).toBeVisible();
  await page.getByRole("button", { name: "Find alternatives" }).click();
  await page.getByRole("button", { name: "Preview Oak Frame Table" }).click();
  await expect(page.getByText("Previewing Oak Frame Table")).toBeVisible();
  await page.getByRole("button", { name: "Run Agent move" }).click();
  await expect(page.getByRole("heading", { name: "Agent activity" })).toBeVisible();
  await page.getByRole("button", { name: "View cart" }).click();
  const dialog = page.getByRole("dialog", { name: "Review your room" });
  await expect(dialog.getByRole("listitem")).toHaveCount(4);
  await expect(dialog.getByRole("button", { name: "Continue to Shopify · $626" })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(consoleErrors).toEqual([]);
});
```

- [ ] **Step 2: Run unit and E2E tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/home-shell.test.tsx
pnpm exec playwright test tests/e2e/home-shell.spec.ts tests/e2e/demo-workspace.spec.ts --config=playwright.config.ts
```

Expected: home tests fail on old copy and demo E2E fails until integration/polish exists.

- [ ] **Step 3: Implement the landing page and responsive/accessibility polish**

Update the landing page to use the same tokens and local room asset, make `/demo` the
primary call to action, and state that the room is approximate. Ensure the demo CSS
fits 1280×720, all four cart lines and both buttons remain in the viewport, focus is
visible, the object list works without the image, and reduced motion disables the
replacement transition.

- [ ] **Step 4: Update README truthfully**

Document that the deterministic UI shell is implemented and that R3F, WebMCP,
Shopify, Tripo, upload, and external cart writes remain future work. Add `/demo` to
the local run instructions without calling it a live deployed demo.

- [ ] **Step 5: Run the complete verification matrix**

Run:

```bash
pnpm install --frozen-lockfile
pnpm run test
pnpm run test:e2e
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run build:next
git diff --check
```

Expected: every command exits 0, Playwright reports zero console errors, and both
build targets include `/demo`.

- [ ] **Step 6: Commit**

Commit: `feat(ui): ship the deterministic Nook demo experience`
