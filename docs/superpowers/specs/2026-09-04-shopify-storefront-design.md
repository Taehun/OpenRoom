# OpenRoom Shopify Storefront Design

Date: 2026-09-04. Status: approved direction (owner: make
`openroom-vahokae7.myshopify.com` read as a real furniture shop — theme,
homepage, navigation, collection copy; scope chosen as "theme + store
structure"; theme work goes through the Shopify CLI).

## 1. Outcome

The development store stops looking like a seeded product dump and starts
looking like a small, deliberate furniture shop. A visitor landing on the
storefront sees an OpenRoom-branded Horizon theme in the app's own palette, a
homepage that leads with a room and then the eight categories, category
collections that carry a sentence of copy and a representative image, a
navigation menu grouped the way a furniture shop groups things, and footer
pages that exist rather than 404.

Nothing about the running app changes. Product handles, variant ids, prices,
and images stay exactly as `pnpm shop:seed` left them, so
`NEXT_PUBLIC_SHOPIFY_VARIANTS` and every cart permalink keep resolving.

## 2. Governing Invariants

- `src/` and `app/` are untouched. This is storefront presentation, not app
  code, and no WebMCP contract, handler, or eval journey changes.
- Commerce stays token-free and server-free (AGENTS.md): the app still builds
  cart permalinks and points agents at `/api/ucp/mcp`. Nothing here adds a
  runtime request or a runtime credential.
- Everything under `examples/shopify/` remains developer tooling: not imported
  by `src/` or `app/`, not bundled, never run in CI.
- The live theme is never overwritten in place. Theme changes are pushed to an
  **unpublished** development theme; publishing is the owner's action.
- Admin credentials live only in `.env.local`. The Shopify CLI holds its own
  browser session and is never given the Admin API token.
- No external write happens without the owner approving that specific command.

## 3. Current State

Established by inspection before this spec:

| Fact | Value |
| --- | --- |
| Store | `openroom-vahokae7.myshopify.com`, password-protected dev store |
| Live theme | `Horizon`, id `162840674541`, the only theme installed |
| Catalog | 43 products, 8 smart collections, vendor `OpenRoom` |
| Categories | Sofa 5, Chair 5, Coffee table 5, Side table 5, Bookshelf 5, Floor lamp 8, Rug 5, Plant 5 |
| Price range | $89 – $2,299 |
| Product copy | One descriptive sentence plus a `W × D × H cm` line |
| Tags | Material, colour, style, and form tags (`Japandi`, `Light wood`, `Natural cream`, …) |
| App scopes | `read_products`, `write_products`, `write_publications` only |
| CLI | Not installed; used through `pnpm dlx @shopify/cli` |

## 4. Theme Approach

Horizon stays. Only `config/settings_data.json` and `templates/*.json` are
edited — no Liquid is modified and no section is added to `sections/*.liquid`.
This keeps the theme upgradable, keeps the diff small and reviewable, and keeps
every change reversible by restoring one JSON file.

Rejected alternatives: replacing Horizon with Dawn (older, and swapping themes
buys nothing the settings cannot); writing custom Liquid sections that port the
app's Material tokens wholesale (best brand fidelity, but a maintenance burden
out of proportion to a demo store).

**Workflow.** The theme is pulled into `examples/shopify/theme/` and committed,
so the storefront is reproducible from the repository rather than living only
in Shopify's admin:

```bash
pnpm shop:theme:pull     # pull the live Horizon theme into examples/shopify/theme
pnpm shop:theme:check    # shopify theme check — schema and Liquid lint
pnpm shop:theme:dev      # local preview against the store
pnpm shop:theme:push     # push to an UNPUBLISHED development theme
```

`shop:theme:push` targets a development theme by name (`OpenRoom (dev)`) and
never passes `--live`. The owner reviews the preview URL and publishes from the
admin.

## 5. Brand System

Taken from the app's Material 3 tokens (`app/material-tokens.css`) so the store
and the app read as one product. The catalog's Japandi / natural-cream tone
agrees with it.

| Role | Token | Hex |
| --- | --- | --- |
| Page background | `--md-sys-color-surface` | `#FBF9F4` |
| Card / raised surface | `surface-container-lowest` | `#FFFFFF` |
| Secondary surface | `surface-container` | `#EFEDE8` |
| Body text | `on-surface` | `#1B1C19` |
| Secondary text | `on-surface-variant` | `#43483F` |
| Accent (buttons, links) | `primary` — moss green | `#4B6543` |
| Accent foreground | `on-primary` | `#FFFFFF` |
| Accent tint | `primary-container` | `#CDEBC1` |

Type: the app ships Roboto, so the store uses the nearest grotesque in
Shopify's font library for both headings and body, with headings differentiated
by size and weight rather than by a second family. Buttons and cards take a
small radius, matching the 8px round of the app's icon mark.

Logo: `app/icon.svg` — the moss-green rounded mark — placed next to the
"OpenRoom" wordmark in the header. Favicon from the same file.

## 6. Homepage

`templates/index.json`, in order:

1. **Hero.** A room scene image, the line *"Design the room. Then buy it."*, a
   supporting sentence, and a `Shop all` button.
2. **Category grid.** All eight collections as a collection list, image plus
   name, three across on desktop.
3. **Featured collection — Sofa.** Five products.
4. **Brand story.** Two short paragraphs on what OpenRoom is (arrange a room
   with an AI assistant, then buy the room), with an image and a link to
   `/pages/about`.
5. **Featured collection — Floor lamp.** Eight products.
6. **Three-column trust row.** Real measured dimensions on every product /
   Shipping / Returns.
7. **Footer.** Navigation plus policy links.

Collection and product templates get lighter treatment: a collection banner
with the description, a product page with the dimension line surfaced near the
price rather than buried in the body copy.

## 7. Store Structure and the Scope Split

The app's Admin API scopes cover products and publications only. Work divides
along that line:

| Item | Path |
| --- | --- |
| Theme settings and templates | Shopify CLI — automated in this repo |
| Collection descriptions, images, sort order | `write_products` script — automated in this repo |
| Header and footer navigation menus | Needs `write_online_store_navigation` — **not granted**; entered by hand from `examples/shopify/content/menus.md` |
| About and policy pages | Needs `write_online_store_pages` — **not granted**; entered by hand from `examples/shopify/content/pages/` |

The hand-entered content is written to the repository as source files rather
than pasted into chat, so that adding the two scopes later turns them into
script input without rewriting anything.

**Navigation.** Main menu: `Shop all`, `Seating` (Sofa, Chair), `Tables`
(Coffee table, Side table), `Storage` (Bookshelf), `Lighting` (Floor lamp),
`Decor` (Rug, Plant), `About`. Footer menu: About, Shipping, Returns, Privacy,
Contact.

**Collection copy.** One sentence per category, written to sit under the
collection banner, plus a representative product image promoted to the
collection image and a default sort order (manual for the flagship categories,
best-selling elsewhere is meaningless on a dev store, so price-ascending).

## 8. Repository Changes

```
examples/shopify/theme/                      # pulled Horizon source, committed
examples/shopify/content/menus.md            # menu structure, for hand entry or a later script
examples/shopify/content/pages/about.md
examples/shopify/content/pages/shipping.md
examples/shopify/content/pages/returns.md
examples/shopify/content/pages/privacy.md
examples/shopify/src/collections.ts          # pure: category → description, image handle, sort
examples/shopify/scripts/decorate-collections.ts
tests/unit/shopify-collections.test.ts
package.json                                 # shop:collections, shop:theme:*
examples/shopify/README.md                   # theme and collection workflow
```

`decorate-collections.ts` follows the existing seed-kit shape: a pure planning
function in `src/collections.ts` that the unit test drives, a thin script that
reads `.env.local`, supports `--dry-run`, and prints one line per collection.

## 9. Testing

- `examples/shopify/src/collections.ts` is pure and unit-tested in
  `tests/unit/shopify-collections.test.ts`, written first, in the style of
  `tests/unit/shopify-seed-kit.test.ts`.
- Theme JSON is validated with `shopify theme check` before any push.
- `pnpm shop:collections --dry-run` runs and is reviewed before the real write.
- Theme pushes go to the unpublished `OpenRoom (dev)` theme and are reviewed on
  its preview URL.
- Before completion: `pnpm test`, `pnpm typecheck`, `pnpm lint` once each.
  `pnpm build` is not required — no runtime or build code changes.

## 10. Owner Actions

1. **Shopify CLI login** — done (`theme list` authenticated; Horizon confirmed).
2. **Admin API token** — expires every 24 hours; a fresh one is needed in
   `.env.local` before `pnpm shop:collections` can write. Theme work does not
   need it.
3. **Approve each outbound command** — the auto-mode classifier prompts on
   every request that carries store credentials.
4. **Publish the theme** — after reviewing the development theme's preview.
5. **Enter menus and pages** — from `examples/shopify/content/`, unless the two
   extra scopes are added, in which case this becomes a script.

## 11. Out of Scope

Removing the storefront password, payment gateway setup, shipping and tax
configuration, a custom domain, and any change to the app's commerce provider
configuration. The owner declined the operational-settings tier; opening the
store to the public is a separate decision.
