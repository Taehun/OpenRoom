# OpenRoom Brand, Material Tokens, and One-Screen Guide Design

Date: 2026-09-03. Status: approved (owner: name "OpenRoom", tagline
"AI Room Planner & Furniture Shopping", full rename incl. repository, package,
Worker, identifiers; scope "guide restructure + shared tokens"; fonts Roboto +
Roboto Mono; principles "intuitive, clean, refined; remove everything that
looks crude").

## 1. Outcome

The product is called **OpenRoom** everywhere: page title, wordmark, README,
package, Worker, MCP companion, environment variables, asset ids, code
identifiers, GitHub repository. The first screen a visitor without WebMCP sees
fits on one viewport and answers two questions in order: *does this browser
support WebMCP, and what do I do about it* and *how do I connect the AI app I
already use*. Every surface shares one Material Design 3 token set (color
roles, Roboto type scale, shape, state layers) so the guide and the dashboard
read as one calm, refined product instead of a patchwork.

## 2. Principles

Intuitive: one primary action per section, verbs on buttons, no jargon
before the action. Clean: one type family, tonal surfaces instead of borders
and shadows, generous whitespace, nothing decorative. Refined: consistent
radii, aligned baselines, quiet status colors, no serif display type, no
eyebrow labels, no stacked notes. Anything that does not help the visitor act
is folded into a `details` disclosure or a link to the README.

## 3. Rename (OpenInterior → OpenRoom)

| where | value |
|---|---|
| display name | `OpenRoom` |
| tagline | `AI Room Planner & Furniture Shopping` (metadata description, README subtitle, guide subtitle) |
| package name | `openroom` |
| Worker name (`wrangler.jsonc`) | `openroom` → live `https://openroom.taehun.workers.dev` |
| companion script | `pnpm mcp:openroom`, directory `scripts/openroom-mcp/`, server name `openroom-mcp`, log prefix `openroom-mcp:` |
| environment | `OPENROOM_MCP_PORT`, `OPENROOM_ALLOWED_ORIGINS` (and any later `OPENROOM_*`) |
| code identifiers | `OPENROOM_PHOTO_CALIBRATION`, `OPENROOM_ROOM_BACKGROUND`, `OPENROOM_ROOM_BEFORE`, `OpenRoomIcon` in `open-room-icon.tsx`, aria label `OpenRoom home` |
| assets | `public/demo/openroom-room.png`, `public/demo/photo/openroom-room-empty.webp`, `public/demo/photo/openroom-room-before.webp`; registry ids `openroom-room-empty`, `openroom-room-before` |
| docs | README, CONTRIBUTING, LICENSE, `docs/local-mcp.md`, `docs/NEXT_SESSION.md`, `.env.example`, evals; dated files under `docs/superpowers/**` and `.superpowers/**` are historical records and stay unchanged |
| GitHub | repository renamed to `Taehun/OpenRoom` at merge time (`gh repo rename`), remote URL updated, badge and links updated |

A test asserts that no tracked source, test, doc (outside `docs/superpowers`),
config, or asset path still contains `openinterior`, `OpenInterior`,
`OPENINTERIOR`, or `open-interior` (case-insensitive), so a straggler fails CI.

## 4. Material tokens

`app/material-tokens.css` (imported first from `globals.css`) defines, on
`:root`, the light scheme below, the type scale, shape, and state-layer
opacities. Legacy names (`--ink`, `--paper`, `--limestone`, `--warm-divider`,
`--muted-text`, `--moss`, `--terracotta`) become aliases of Material roles so
the 130 existing usages in `demo-workspace.module.css` adopt the palette
without per-rule edits; the 31 hard-coded hex colors in that file are replaced
by roles.

Color roles (seeded from the existing moss green, warm neutral surfaces):

```
--md-sys-color-primary: #4B6543;            --md-sys-color-on-primary: #FFFFFF;
--md-sys-color-primary-container: #CDEBC1;  --md-sys-color-on-primary-container: #0A2008;
--md-sys-color-secondary: #55624C;          --md-sys-color-on-secondary: #FFFFFF;
--md-sys-color-secondary-container: #D9E7CB;--md-sys-color-on-secondary-container: #131F0D;
--md-sys-color-tertiary: #8A5A3C;           --md-sys-color-on-tertiary: #FFFFFF;
--md-sys-color-tertiary-container: #FFDBC9; --md-sys-color-on-tertiary-container: #321200;
--md-sys-color-error: #BA1A1A;              --md-sys-color-on-error: #FFFFFF;
--md-sys-color-error-container: #FFDAD6;    --md-sys-color-on-error-container: #410002;
--md-sys-color-surface: #FBF9F4;            --md-sys-color-on-surface: #1B1C19;
--md-sys-color-surface-dim: #DBDAD3;        --md-sys-color-surface-bright: #FBF9F4;
--md-sys-color-surface-container-lowest: #FFFFFF;
--md-sys-color-surface-container-low: #F5F3EE;
--md-sys-color-surface-container: #EFEDE8;
--md-sys-color-surface-container-high: #E9E7E2;
--md-sys-color-surface-container-highest: #E3E2DC;
--md-sys-color-on-surface-variant: #43483F; --md-sys-color-outline: #73796E;
--md-sys-color-outline-variant: #C3C8BC;    --md-sys-color-inverse-surface: #303129;
--md-sys-color-inverse-on-surface: #F2F0EB; --md-sys-color-inverse-primary: #B1D1A4;
```

Aliases: `--ink → on-surface`, `--muted-text → on-surface-variant`,
`--paper → surface-container-lowest`, `--limestone → surface`,
`--warm-divider → outline-variant`, `--moss → primary`, `--terracotta → tertiary`.

Type scale (Roboto via `next/font/google`, variable `--font-ui`; Roboto Mono
as `--font-mono`; `--font-editorial` is removed and its four usages switch to
`--font-ui`): display-large 57/64 400 −0.25px, headline-large 32/40 400,
headline-medium 28/36 400, headline-small 24/32 400, title-large 22/28 400,
title-medium 16/24 500 0.15px, title-small 14/20 500 0.1px, body-large 16/24
400 0.5px, body-medium 14/20 400 0.25px, body-small 12/16 400 0.4px,
label-large 14/20 500 0.1px, label-medium 12/16 500 0.5px. Exposed as
`--md-sys-typescale-<name>-size|line-height|weight|tracking`.

Shape: `--md-sys-shape-corner-extra-small: 4px`, `small: 8px`, `medium: 12px`,
`large: 16px`, `extra-large: 28px`, `full: 9999px`. State layers:
`--md-sys-state-hover-opacity: 0.08`, `focus 0.12`, `pressed 0.12`. Elevation
level 1 shadow `0 1px 2px rgba(0,0,0,.30), 0 1px 3px 1px rgba(0,0,0,.15)`,
used only by the top app bar on scroll and dialogs.

## 5. Component classes

`app/material-components.css` (global, imported after the tokens) provides
the small set the guide and dashboard chrome need. Each class is plain CSS,
no JavaScript:

- `.md-button` with modifiers `--filled`, `--tonal`, `--outlined`, `--text`:
  40px height, full-round corner, label-large, 24px horizontal padding
  (16px for `--text`), state layer on hover/focus/active, `:disabled` at
  38% opacity, `:focus-visible` outline in `--md-sys-color-primary` 2px offset
  2px.
- `.md-card` with `--filled` (surface-container-highest), `--outlined`
  (1px outline-variant on surface), `--elevated` (surface-container-low,
  elevation 1); corner medium; 16px/24px padding.
- `.md-chip` (assist chip): 32px, corner small, label-large, outline-variant
  border; `.md-chip--selected` uses secondary-container.
- `.md-top-app-bar`: 64px, surface, title-large, sticky.
- `.md-nav-rail`: 80px wide column, surface, items 56px with label-medium.
- `.md-banner`: surface-container-low, corner medium, icon + title-medium +
  body-medium + trailing actions.
- `.md-code`: Roboto Mono body-medium on surface-container, corner small,
  inline padding 2px 6px.
- `.md-dialog`: native `<dialog>` styled surface-container-high, corner
  extra-large, 24px padding, headline-small title, actions right-aligned;
  backdrop `rgba(0,0,0,.32)`.

## 6. Guide (browser without WebMCP)

One viewport at 1440×900; sections in order, all inside a 1040px column:

1. **Top app bar**: wordmark `OpenRoom` (title-large), right: `Open the demo`
   text button.
2. **Hero** (two columns ≥ 900px): headline-large `OpenRoom`, title-large
   `AI Room Planner & Furniture Shopping`, body-large one sentence
   (`Furnish a real room photo with catalog products — by hand, or through
   the AI app you already use.`), buttons `Open the demo` (filled) and
   `Connect an AI app` (tonal, anchor to section 4). Right column: the room
   image in a corner-large frame, no caption.
3. **Status banner** (`section` with accessible name `WebMCP in this browser`,
   `role="status"` on the title): one of
   - flag-required: `Needs a flag in Chromium 151` · body: `Enable WebMCP for
     testing, relaunch, then check again.` · actions `Copy flag address`
     (tonal) and `Check again` (text); the flag address in `.md-code`.
   - update-required: `Update Chrome to 146 or newer` · `You are on Chromium
     140.` · action `Check again`.
   - unsupported-browser: `Not available in Safari` · `Use Google Chrome 146
     or newer.` · `Check again`.
   - insecure-context: `Needs HTTPS or localhost` · `Open this page over HTTPS
     or on http://localhost.` · `Check again`.
   - ready: `Ready — WebMCP detected` · action `Open the dashboard` (filled).
   - checking (before mount): `Checking your browser…`, no actions.
   Detected browser and secure-context facts appear as one body-small line
   under the title (`Chromium 151 · secure context`), never as a table.
4. **Connect an AI app** (`section` named `Connect an AI app`): three outlined
   cards in one row (stacked under 900px):
   - `ChatGPT & Codex app` — `Open OpenRoom in the ChatGPT desktop app's
     browser. Nothing else to install.` — link `Open the dashboard`.
   - `Claude Code & Claude Desktop` — steps: 1 `pnpm mcp:openroom`,
     2 `claude mcp add openroom -- pnpm --silent --dir <repo> mcp:openroom`,
     3 `Type the six-digit code into the dashboard.` — each command in
     `.md-code` with a `Copy` text button; link `Open the dashboard`.
   - `Codex CLI` — steps: 1 `pnpm mcp:openroom`, 2 `codex mcp add openroom --
     pnpm --silent --dir <repo> mcp:openroom`, 3 same as above; link `Open the
     dashboard`.
   `<repo>` is literal text the reader replaces; the copy buttons copy the
   command verbatim.
5. **Details** (`details` disclosures, closed by default, body-medium):
   `What an agent can do` (the six tools as `name — description`),
   `Shopping with your agent` (one sentence + README link),
   `Open source` (MIT, GitHub link).

Removed: the eyebrow, the serif headline, the intro paragraph, the facts table,
the "Verified on Google Chrome" and origin-trial notes (the origin-trial fact
moves into the README), the four stacked panels.

The existing anchors `/?view=dashboard` (plain `<a>`, full navigation) and
`/demo` keep their hrefs; button and link names `Open the demo`,
`Open the dashboard`, `Copy flag address`, `Check again` are unchanged so the
E2E journeys keep working; the region name changes from `WebMCP compatibility`
to `WebMCP in this browser` and tests are updated.

## 7. Dashboard

Tokens only, plus two targeted simplifications:

- Header wordmark `OpenRoom`; the header, tool rail, inspector, and composer
  use `.md-*` classes for buttons and cards where a class replaces a bespoke
  rule one-for-one; no layout changes.
- The pairing row becomes a `Connect an AI app` tonal button beside a status
  chip (`role="status"`, accessible name `Local agent connection status`,
  text `Local agent: Not connected | Pairing… | Connected | Connection lost`).
  The button opens a `.md-dialog` (`<dialog>`, name `Connect an AI app`) with
  one body-medium hint (`Run pnpm mcp:openroom in the repository and type the
  six-digit code it prints.`), the `Pairing code` field, the relay-port field
  as a `details` disclosure, a `Connect` filled button, and `Cancel`. Errors
  show inside the dialog as body-small in `--md-sys-color-error`. Existing
  relay logic, security, and messages are unchanged; only the presentation
  moves.

## 8. Testing

Unit: token file exists and exposes the alias roles (a test imports the CSS
text and asserts the seven alias lines); guide renders each status variant
with the exact titles above; copy buttons write the exact commands; details
are closed by default; dashboard dialog opens, submits a valid code through
the relay mock, and shows the error note; rename straggler test (section 3).
E2E (`home-shell.spec.ts`): heading `OpenRoom`, region `WebMCP in this
browser`, `Copy flag address`, `Open the demo`, `Open the dashboard`, dialog
opens from `Connect an AI app`, `Local agent: Not connected`. Full gate:
`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm test:e2e`, `pnpm build:next`,
`pnpm build`.

## 9. Acceptance

1. `grep -ri openinterior` over tracked files outside `docs/superpowers` and
   `.superpowers` finds nothing; `pnpm mcp:openroom` starts and prints
   `openroom-mcp:` lines.
2. The guide fits one 1440×900 viewport above the details disclosures and
   shows the five status variants with the exact copy in section 6.
3. Every button, card, chip, code, and dialog on both pages uses the Material
   classes and tokens; no serif type remains; no hex color remains in
   `home.module.css` or `demo-workspace.module.css`.
4. The pairing dialog pairs with the companion exactly as the old row did
   (integration test unchanged apart from names).
