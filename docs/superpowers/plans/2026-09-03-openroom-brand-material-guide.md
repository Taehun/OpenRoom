# OpenRoom Brand, Material Tokens, and One-Screen Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product to OpenRoom everywhere, introduce Material Design 3 tokens and a small component-class set shared by every page, rebuild the no-WebMCP guide as one intuitive screen, and simplify the dashboard's pairing controls into a button and dialog.

**Architecture:** A mechanical rename lands first so every later file uses the final name. Tokens live in `app/material-tokens.css` with legacy aliases so the dashboard adopts the palette without touching its 130 token usages; component classes live in `app/material-components.css`. The guide component is rewritten around a status banner and three connection cards; the dashboard keeps its layout and swaps the pairing row for a dialog.

**Tech Stack:** Next 16.3.3 App Router, React 19, CSS modules + global CSS, `next/font/google` (Roboto, Roboto Mono), Vitest 4 (jsdom), Playwright 1.62, pnpm 10.27.0, Node 24.13.1.

**Spec:** `docs/superpowers/specs/2026-09-03-openroom-brand-material-guide-design.md`

## Global Constraints

- Display name `OpenRoom`; tagline `AI Room Planner & Furniture Shopping`; package `openroom`; Worker `openroom`; script `pnpm mcp:openroom`; dir `scripts/openroom-mcp/`; server name `openroom-mcp`; env `OPENROOM_MCP_PORT`, `OPENROOM_ALLOWED_ORIGINS`; identifiers `OPENROOM_PHOTO_CALIBRATION`, `OPENROOM_ROOM_BACKGROUND`, `OPENROOM_ROOM_BEFORE`, `OpenRoomIcon` (`open-room-icon.tsx`), aria `OpenRoom home`; assets `openroom-room.png`, `openroom-room-empty.webp`, `openroom-room-before.webp`, ids `openroom-room-empty`, `openroom-room-before` (spec 3).
- `docs/superpowers/**` and `.superpowers/**` stay unchanged (historical records).
- Color, type, shape, and state tokens exactly as spec section 4; aliases `--ink→on-surface`, `--muted-text→on-surface-variant`, `--paper→surface-container-lowest`, `--limestone→surface`, `--warm-divider→outline-variant`, `--moss→primary`, `--terracotta→tertiary`.
- Fonts: Roboto (`--font-ui`) and Roboto Mono (`--font-mono`) via `next/font/google`; `--font-editorial` removed.
- Guide copy, section names, and button names exactly as spec section 6; dashboard status text `Local agent: Not connected | Pairing… | Connected | Connection lost`, status accessible name `Local agent connection status`, dialog name `Connect an AI app` (spec 7).
- Relay logic, security, pairing messages, and the Core 6 are unchanged.
- Repository workflow (AGENTS.md): narrowest Vitest first; `pnpm test`, `pnpm typecheck`, `pnpm lint` before completion; `pnpm build:next` and `pnpm build` for build changes; `pnpm test:e2e` for browser flows. Never deploy.
- Port 3000 belongs to the owner's dev server. For E2E in this worktree start `pnpm exec next dev --hostname 127.0.0.1 --port 3200` in the background and run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm test:e2e`; stop only the server you started. Never use git amend/rebase/reset/stash.

---

### Task 1: Rename OpenInterior → OpenRoom

**Files:**
- Rename: `scripts/openinterior-mcp/` → `scripts/openroom-mcp/`; `src/features/demo/open-interior-icon.tsx` → `open-room-icon.tsx`; `public/demo/openinterior-room.png` → `openroom-room.png`; `public/demo/photo/openinterior-room-empty.webp` → `openroom-room-empty.webp`; `public/demo/photo/openinterior-room-before.webp` → `openroom-room-before.webp` (use `git mv`).
- Modify: every tracked file listed by `git grep -il "openinterior\|open-interior" -- . ':!docs/superpowers' ':!.superpowers'` (44 files today, including `package.json`, `wrangler.jsonc`, `.env.example`, `README.md`, `CONTRIBUTING.md`, `LICENSE`, `docs/local-mcp.md`, `docs/NEXT_SESSION.md`, `app/layout.tsx`, `app/demo/page.tsx`, `src/**`, `tests/**`, `playwright.commerce.config.ts`, `.github/workflows/ci.yml` if it names the Worker).
- Test: `tests/unit/brand-name.test.ts`

**Interfaces:**
- Produces: the identifiers in Global Constraints; `package.json` `name: "openroom"`, `repository.url: "https://github.com/Taehun/OpenRoom.git"`, `homepage: "https://github.com/Taehun/OpenRoom#readme"`; README title `# OpenRoom`, subtitle line `AI Room Planner & Furniture Shopping`, badge `https://github.com/Taehun/OpenRoom/actions/workflows/ci.yml/badge.svg`, live URL `https://openroom.taehun.workers.dev`; `app/layout.tsx` metadata `title: "OpenRoom"`, `description: "AI Room Planner & Furniture Shopping"`.

- [ ] **Step 1: Write the straggler test**

```ts
// tests/unit/brand-name.test.ts
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("brand name", () => {
  it("leaves no OpenInterior reference outside the historical design records", () => {
    const output = execFileSync(
      "git",
      ["grep", "-il", "openinterior\\|open-interior", "--", ".", ":!docs/superpowers", ":!.superpowers"],
      { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    expect(output).toBe("");
  });
});
```

`git grep` exits 1 when nothing matches; wrap the call so a non-zero exit with empty output counts as pass (catch the error, read `error.stdout`, assert it is empty).

- [ ] **Step 2: Run it** — `pnpm vitest run tests/unit/brand-name.test.ts` — Expected: FAIL listing 44 files.

- [ ] **Step 3: Rename** — `git mv` the five paths; then apply the replacements in this order across the file list (excluding `docs/superpowers`, `.superpowers`, `pnpm-lock.yaml` which only carries the package name and is regenerated by `pnpm install --lockfile-only`): `OpenInteriorIcon→OpenRoomIcon`, `open-interior-icon→open-room-icon`, `OPENINTERIOR_→OPENROOM_`, `openinterior-mcp→openroom-mcp`, `mcp:openinterior→mcp:openroom`, `OpenInterior→OpenRoom`, `openinterior→openroom`, `open-interior→open-room`. Then hand-edit: README first lines to the title/subtitle/links in Interfaces; `app/layout.tsx` metadata; `LICENSE` copyright line keeps the year and holder, product name updated; `docs/local-mcp.md` example commands (`claude mcp add … openroom`, `codex mcp add openroom`, log file `openroom-mcp.log`); `wrangler.jsonc` name; `.github/workflows/ci.yml` any `openinterior` text. Run `pnpm install --lockfile-only` and commit the lockfile.

- [ ] **Step 4: Gates** — `pnpm vitest run tests/unit/brand-name.test.ts tests/unit/photo-assets.test.ts tests/unit/pair-code-announcer.test.ts tests/unit/relay-http.test.ts && pnpm test && pnpm typecheck && pnpm lint && pnpm build:next && pnpm build`. Then `pnpm mcp:openroom` for three seconds (`timeout 3 pnpm mcp:openroom; true`) and confirm the stderr lines start with `openroom-mcp:`. E2E on port 3200: `home-shell.spec.ts`, `photo-assets.spec.ts`, `webmcp-core.spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: rename OpenInterior to OpenRoom"`.

---

### Task 2: Material tokens, fonts, component classes, dashboard adoption and pairing dialog

**Files:**
- Create: `app/material-tokens.css`, `app/material-components.css`
- Modify: `app/globals.css` (import both first; remove the landing-only `.shell/.intro/.eyebrow/h1/.summary/.demo-link` rules if unused after Task 3 — check with `git grep`), `app/layout.tsx` (Roboto + Roboto Mono), `src/features/demo/demo-workspace.module.css` (replace 31 hex colors with roles; buttons/cards/chips/dialog use `.md-*` where one-for-one), `src/features/demo/workspace-header.tsx`, `src/features/demo/local-agent-status.tsx` (button + dialog), `src/features/demo/demo-workspace.tsx` (only if the composer row markup must change)
- Test: `tests/unit/material-tokens.test.ts`, `tests/unit/demo-workspace.test.tsx`, `tests/unit/home-gate.test.tsx` (status text), `tests/integration/local-mcp-companion.test.ts` (names only), `tests/e2e/home-shell.spec.ts`, `tests/e2e/demo-workspace.spec.ts`

**Interfaces:**
- Consumes: Task 1 names.
- Produces: the `.md-*` classes and tokens from spec sections 4–5; `LocalAgentStatus` renders `<button class="md-button md-button--tonal">Connect an AI app</button>` and `<dialog aria-labelledby=… >` with the `Pairing code` field, `Connect` and `Cancel` buttons; status chip with `role="status"` and `aria-label="Local agent connection status"`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/material-tokens.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync("app/material-tokens.css", "utf8");
describe("material tokens", () => {
  it("defines the color roles and legacy aliases", () => {
    for (const line of [
      "--md-sys-color-primary: #4B6543",
      "--md-sys-color-surface: #FBF9F4",
      "--md-sys-color-outline-variant: #C3C8BC",
      "--ink: var(--md-sys-color-on-surface)",
      "--muted-text: var(--md-sys-color-on-surface-variant)",
      "--paper: var(--md-sys-color-surface-container-lowest)",
      "--limestone: var(--md-sys-color-surface)",
      "--warm-divider: var(--md-sys-color-outline-variant)",
      "--moss: var(--md-sys-color-primary)",
      "--terracotta: var(--md-sys-color-tertiary)",
      "--md-sys-shape-corner-extra-large: 28px",
      "--md-sys-typescale-label-large-size: 14px",
    ]) expect(tokens).toContain(line);
  });
  it("leaves no hex color in the module stylesheets", () => {
    for (const file of ["src/features/demo/demo-workspace.module.css", "src/features/home/home.module.css"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
```

In `tests/unit/demo-workspace.test.tsx` add: clicking `Connect an AI app` opens a dialog named `Connect an AI app` containing a `Pairing code` textbox; typing `123456` and pressing `Connect` calls the relay mock's `pair("123456")`; a rejected pair shows `Pairing was rejected. Check the code and try again.` inside the dialog; `Cancel` closes it; the status element has accessible name `Local agent connection status` and text `Local agent: Not connected`. (jsdom lacks `HTMLDialogElement.showModal`; polyfill in the test setup with `HTMLDialogElement.prototype.showModal = function () { this.open = true; }` and `close` likewise.)

- [ ] **Step 2: Run** — `pnpm vitest run tests/unit/material-tokens.test.ts tests/unit/demo-workspace.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement** the token file verbatim from spec 4, the component classes from spec 5, the layout fonts:

```tsx
import { Roboto, Roboto_Mono } from "next/font/google";
const ui = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], display: "swap", variable: "--font-ui" });
const mono = Roboto_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap", variable: "--font-mono" });
// <html className={`${ui.variable} ${mono.variable}`}>
```

Replace every `var(--font-editorial)` with `var(--font-ui)`; replace hex colors in `demo-workspace.module.css` with the nearest role (`rgba(0,0,0,…)` shadows may stay only for the dialog and app bar elevation); apply `.md-button--filled` to the primary actions (`Find alternatives`, `View cart`, `Copy redesign prompt`), `.md-button--text` to `Undo`/`Reset Demo`/`Guide`, `.md-chip` to the style chips and the status chip, `.md-card--outlined` to the inspector callout. Do not change the stage/rail layout.

`local-agent-status.tsx`: keep the hooks and relay calls; render the status chip, the `Connect an AI app` tonal button, and a `<dialog>` (ref + `showModal()`/`close()`); the relay-port field goes inside a `details` disclosure labelled `Advanced`; on successful pair close the dialog.

- [ ] **Step 4: Gates** — the two unit files, then `pnpm test && pnpm typecheck && pnpm lint && pnpm build:next`; E2E on port 3200: `home-shell.spec.ts`, `demo-workspace.spec.ts`, `photo-compositor.spec.ts` (only its non-performance tests: run with `CI=1`). Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(design): add Material tokens and components; simplify agent pairing into a dialog"`.

---

### Task 3: One-screen guide

**Files:**
- Modify: `src/features/home/webmcp-guide.tsx` (rewrite), `src/features/home/home.module.css` (rewrite: layout only, colors via tokens, classes via `.md-*`), `src/features/home/home-gate.tsx` (no logic change; pass-through)
- Test: `tests/unit/home-gate.test.tsx`, `tests/e2e/home-shell.spec.ts`

**Interfaces:**
- Consumes: `.md-*` classes and tokens (Task 2), names from Task 1.
- Produces: the guide DOM described in spec section 6; exported `CONNECT_COMMANDS` constant `{ claude: "claude mcp add openroom -- pnpm --silent --dir <repo> mcp:openroom", codex: "codex mcp add openroom -- pnpm --silent --dir <repo> mcp:openroom", start: "pnpm mcp:openroom" }` for tests.

- [ ] **Step 1: Write failing tests** (replace the guide expectations in `tests/unit/home-gate.test.tsx`):

```ts
it("renders the one-screen guide for a flag-required browser", () => {
  renderGuide({ kind: "flag-required", browser: { brand: "Chromium", version: 151, verified: false } });
  expect(screen.getByRole("heading", { level: 1, name: "OpenRoom" })).toBeVisible();
  expect(screen.getByText("AI Room Planner & Furniture Shopping")).toBeVisible();
  const banner = screen.getByRole("region", { name: "WebMCP in this browser" });
  expect(within(banner).getByRole("status")).toHaveTextContent("Needs a flag in Chromium 151");
  expect(within(banner).getByText("Chromium 151 · secure context")).toBeVisible();
  expect(within(banner).getByText("chrome://flags/#enable-webmcp-testing")).toBeVisible();
  expect(within(banner).getByRole("button", { name: "Copy flag address" })).toBeVisible();
  expect(within(banner).getByRole("button", { name: "Check again" })).toBeVisible();
  const connect = screen.getByRole("region", { name: "Connect an AI app" });
  expect(within(connect).getAllByRole("link", { name: "Open the dashboard" })).toHaveLength(3);
  expect(within(connect).getByText(CONNECT_COMMANDS.claude)).toBeVisible();
  expect(within(connect).getByText(CONNECT_COMMANDS.codex)).toBeVisible();
  expect(screen.getByRole("link", { name: "Open the demo" })).toHaveAttribute("href", "/demo");
  for (const group of screen.getAllByRole("group")) expect(group).not.toHaveAttribute("open");
});
it.each([
  ["update-required", "Update Chrome to 146 or newer"],
  ["unsupported-browser", "Not available in Safari"],
  ["insecure-context", "Needs HTTPS or localhost"],
  ["ready", "Ready — WebMCP detected"],
])("titles the %s banner", (kind, title) => { /* build the matching status object; assert the status text and that only "Check again" (or "Open the dashboard" for ready) is offered */ });
```

Keep the existing tests for the dashboard/guide switching; update names (`WebMCP in this browser`, `Local agent: Not connected`). Update `home-shell.spec.ts` the same way and add `await expect(page.getByRole("region", { name: "Connect an AI app" })).toBeVisible()`.

- [ ] **Step 2: Run** — `pnpm vitest run tests/unit/home-gate.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement** `webmcp-guide.tsx` per spec 6 (top app bar, hero, banner, three cards, details) using `.md-*` classes and a `CopyButton` that reuses the existing clipboard handling for arbitrary text; `home.module.css` holds only layout (grid, column, spacing) and references tokens. Delete the tool-list duplication comment: import `CORE_TOOL_MANIFEST` descriptions instead of the copied array if the manifest exports them (it does: `src/webmcp/core-tool-manifest.ts`).

- [ ] **Step 4: Gates** — `pnpm vitest run tests/unit/home-gate.test.tsx && pnpm test && pnpm typecheck && pnpm lint && pnpm build:next`; E2E `home-shell.spec.ts` on port 3200; then capture `/?view=guide` at 1440×900 with `pnpm exec playwright screenshot --viewport-size=1440,900 http://127.0.0.1:3200/?view=guide output/playwright/guide-1440x900.png` and confirm the details disclosures are the first thing below the fold. Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(home): rebuild the guide as one Material screen"`.
