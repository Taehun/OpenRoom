# Nook Next.js UI Design

## Status

Approved by the user on 2026-08-31 after review of the Google Stitch project
`13319975674430176550` and its Spatial Atelier direction.

## Goal

Turn the approved Stitch direction into a production-quality Next.js UI shell
that demonstrates Nook's core two-minute story without pretending the later
R3F, WebMCP, Shopify, or provider integrations already exist.

## Scope

This implementation includes:

- a polished landing page with a direct `/demo` call to action;
- a deterministic desktop `/demo` workspace;
- four UI states: object inspector, product alternatives with active preview,
  human/Agent co-edit activity, and cart approval;
- reversible local demo interactions, reset, Escape handling, and keyboard undo;
- an accessible object list and text alternatives for the visual room;
- a 1280×720 layout pass and reduced-motion behavior.

This implementation excludes:

- real Three.js or R3F scene rendering and transforms;
- real WebMCP registration or Agent orchestration;
- Shopify, Tripo, R2, D1, and external network writes;
- upload and room analysis;
- mobile editing.

## Approved Visual Direction

**Direction:** Spatial Atelier. Nook should feel like an interior designer's
worktable translated into precise browser software. The room is the dominant
surface; interface chrome stays quiet.

**Memorable line:** `The room becomes the storefront.`

**Typography:** Newsreader for editorial headings and DM Sans for interface,
prices, dimensions, and controls. Fonts are loaded through `next/font/google`
and self-hosted in the production build.

**Palette:**

- limestone `#F2EFE8`;
- paper `#FBFAF6`;
- warm divider `#D8D2C7`;
- ink `#242722`;
- muted text `#6F736B`;
- moss `#5E6B4E` for selection and active spatial state;
- terracotta `#C8784E` for the explicit commerce approval action.

**Shape and depth:** 1px warm dividers and tonal elevation instead of generic
card shadows. Major radii are 8–12px. Chips may be fully rounded.

## Layout

The supported editor viewport is desktop Chrome at a minimum of 1280×720.

- Header: 64px with Nook, room name, scene revision, provider status, room
  total, Undo, Reset Demo, and cart entry.
- Tool rail: 72px with Select, Move, Rotate, and accessible object list.
- Room canvas: flexible and never less than 55% of the usable workspace width.
- Context panel: 360px for inspector, products, or Agent activity.
- Agent composer: 72px docked to the canvas bottom.
- Cart approval: 500px right sheet layered over the workspace, with all four
  items, total, disclosures, and both actions visible at 1280×720.

At widths below the supported minimum, the UI may compress but must explain
that the editor is desktop-first. Mobile editing is not implemented.

## Deterministic Demo State

`createInitialDemoState()` returns the canonical state:

- mode `inspector`;
- revision `1`;
- selected object `table_01`;
- no preview product;
- cart closed;
- provider `Demo fallback`;
- room total `$0`.

The pure `demoReducer(state, action)` owns UI mutations:

- `show-products` changes the panel without changing revision;
- `preview-product` links the selected table to `oak-frame-table`, increments
  revision by one, changes provider to `Cached`, and makes Undo available;
- `run-agent-move` records the floor-lamp activity, increments revision by one,
  and shows a reversible toast;
- `open-cart` and `close-cart` change only approval visibility;
- `undo` restores the last reversible scene snapshot;
- `reset` restores a fresh canonical state with revision `1`.

State remains local and deterministic. Refreshing `/demo` always restores the
canonical state. No localStorage or server round trip is used.

## Interaction Flow

1. The coffee table is selected on load and the inspector shows dimensions,
   transform summary, style, and lock state.
2. `Find alternatives` opens exactly three product results.
3. Previewing `Oak Frame Table` changes the room label and product state while
   preserving the selected object's displayed transform.
4. Submitting `Move the lamp to work with this layout.` opens Agent activity,
   records `get_scene`, `move_object`, and the resulting revision, and shows an
   Undo toast.
5. `View cart` opens a visible approval sheet with Coffee Table $189, Floor Lamp
   $129, Rug $249, Plant $59, and estimated total $626 USD.
6. `Continue to Shopify` performs no external request. It closes the sheet and
   announces that this UI-only demo created no external cart.

## Accessibility

- Every icon-only action has an accessible name and visible tooltip/title.
- Canvas selection is mirrored by an accessible object list.
- Status is communicated with icon, text, and color.
- Focus uses a 2px moss outer ring and remains visible on paper surfaces.
- Primary controls are at least 44px high.
- Escape closes the cart first, otherwise clears selection.
- Cmd/Ctrl+Z invokes the local demo undo action.
- Reduced motion removes scale/crossfade animation without removing state
  feedback.

## Performance

- Keep `app/demo/page.tsx` as a server component and isolate interactivity in one
  client boundary.
- Keep fixtures and reducer outside React so they can be tested directly.
- Use a bundled local room image with `next/image`; no runtime image fetch.
- Avoid state libraries for this UI-only shell. The later Scene work package will
  introduce Zustand as the shared scene source of truth.

## Validation

- Vitest covers reducer transitions and the user-visible component flow.
- Playwright covers the complete UI journey at 1280×720, keyboard Escape, reset,
  cart visibility, and zero uncaught console errors.
- Typecheck, ESLint, vinext build, and Next.js compatibility build must exit 0.

## Stitch References

- Project: `13319975674430176550`
- Design system: `15004672467395241845`
- Demo workspace: `950a02dd9e6041e6b8a1e56e11d978e1`
- Product preview: `e90df8e580ee4f82841398e10d286ce9`
- Human + Agent co-edit: `c95241839b5f45d289a340102b293107`
- Cart approval: `478c98e9e88f4c0ba9eb32ca300a7afd`
