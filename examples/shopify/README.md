# Shopify furniture store seed kit

Connected OpenRoom commerce is token-free: it builds cart and product links,
points agents at the store's UCP MCP endpoint, and never holds a credential.
What it does need is a store that actually carries the 43 demo products, so the
variant ids in `NEXT_PUBLIC_SHOPIFY_VARIANTS` resolve to something real.

This folder stands one up. It reads the catalog straight out of the app
(`DEMO_PRODUCTS` and `PHOTO_ASSETS`), creates one Shopify product per catalog
entry with a single default variant and the deployed cutout as its image, adds
eight smart collections, publishes everything to the Online Store, and prints
the one environment line OpenRoom needs.

It is **developer tooling**. Nothing here is imported by `src/` or `app/`, no
bundle inlines it, and no CI job runs it. The Admin API token lives in your
`.env.local` and nowhere else.

## Prerequisites

Shopify retired admin-created custom apps on 1 January 2026. There is no
`Settings → Apps and sales channels → Develop apps` path any more and no
permanent `shpat_…` token: an app is created in the **Dev Dashboard**, and its
Admin API token is fetched with a client credentials grant and **expires after
24 hours**. The seeder does not care which kind of token it holds — it only
sends the value as `X-Shopify-Access-Token` — but a re-seed a day later needs a
fresh one.

- Node 24.13.1 and pnpm 10.27.0 (the versions in `package.json` and
  `.node-version`), with `pnpm install --frozen-lockfile` already run.

### 1. A development store

<https://dev.shopify.com/dashboard> → **Stores** → **Create store** → **Dev**.
Leave *Generate test data* unchecked so the 43 seeded products are the only
ones in the store. Afterwards copy the real `….myshopify.com` domain — Shopify
appends a suffix, so a store named `openroom` becomes something like
`openroom-vahokae7.myshopify.com`.

The **Online Store** sales channel must be present; the seeder looks for a
publication named `Online Store` and stops if there is none. A store created
this way has it by default.

### 2. A Dev Dashboard app

In the same dashboard, **Apps** → **Create app** → **Start from Dev Dashboard**.

1. **Versions** tab → *Create version*. The App URL is never called by this kit,
   so the placeholder is fine; leave *Embed app in Shopify admin* unchecked. In
   **API access → Scopes** enter exactly:

   ```text
   read_products,write_products,write_publications,write_online_store_navigation,write_online_store_pages
   ```

   Then select **Release**. Without a released version the scopes are not
   granted, and the token below comes back with an empty `scope`.

   The first three are all `pnpm shop:seed`, `shop:variants`, and
   `shop:collections` need. The last two belong to `pnpm shop:content`, which
   writes the storefront's pages and rewrites its menus; leave them out and
   that one script stops and names what is missing.
2. **Home** → **Install app** → pick the development store → **Install**. The
   browser lands on the app URL with `hmac` and `host` query parameters; that
   redirect *is* the completed install, and the page itself does not matter.
3. **App settings** → copy the **Client ID** and **Client secret**.

### 3. An access token

Put the store domain and the two credentials in `.env.local` **at the
repository root** (git-ignored), then exchange them:

```bash
cat examples/shopify/.env.example >> .env.local
# fill in SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET

curl -s -X POST "https://<store>.myshopify.com/admin/oauth/access_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d grant_type=client_credentials \
  -d client_id=<Client ID> -d client_secret=<Client secret>
```

The response carries `access_token`, the granted `scope`, and
`expires_in: 86399`. Copy the token into `SHOPIFY_ADMIN_ACCESS_TOKEN`. Shopify
folds `read_products` into `write_products`, so `scope` reading
`write_products,write_publications` is correct — an **empty** `scope` means the
app version was never released.

| Variable | Required | Meaning |
| --- | --- | --- |
| `SHOPIFY_STORE_DOMAIN` | yes | `your-store.myshopify.com`, no scheme. |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | yes | The `access_token` from the grant above. Expires in 24 hours; never commit it. |
| `SHOPIFY_CLIENT_ID` | no | Read by nothing here — kept in `.env.local` so the token can be re-minted. |
| `SHOPIFY_CLIENT_SECRET` | no | Same. Never commit it. |
| `SHOPIFY_API_VERSION` | no | Admin GraphQL version; defaults to `2026-01`. |
| `OPENROOM_IMAGE_BASE` | no | Host the cutouts are fetched from; defaults to `https://openroom-webmcp.pages.dev`. |

An older store may still have a working admin-created custom app with a
`shpat_…` token. Those keep working and need none of the above — drop the token
straight into `SHOPIFY_ADMIN_ACCESS_TOKEN`.

## Quick start

Three commands. `shop:export` and `shop:seed --dry-run` need no credentials;
the real seed and `shop:variants` read them from `.env.local`.

```bash
pnpm shop:export                # refresh products.json and products.csv from the catalog
pnpm shop:seed --dry-run        # print the plan; sends nothing
pnpm shop:seed                  # create or update all 43 products and 8 collections
pnpm shop:variants --write      # write NEXT_PUBLIC_SHOPIFY_VARIANTS into .env.local
```

`pnpm shop:seed` prints one line per product:

```text
[seed] hinoki-low-sofa created → gid://shopify/ProductVariant/44352465993
[seed] boucle-curve-sofa updated → gid://shopify/ProductVariant/44352465994
[seed] collection coffee-table created
```

`pnpm shop:variants` without `--write` prints the line to stdout instead, so you
can paste it into a CI variable:

```text
NEXT_PUBLIC_SHOPIFY_VARIANTS=ash-lounge-chair=gid://shopify/ProductVariant/…,…
```

## Import via CSV instead

If you would rather skip the Dev Dashboard app entirely, `products.csv` is a
plain Shopify import file (it is checked in, so no command is needed to obtain
it). This path needs no credential at all.

1. In the store admin go to **Products → Import**.
2. Upload `examples/shopify/products.csv` and confirm.
3. Shopify fetches each `Image Src` from the public URL, so the store needs
   outbound access to `https://openroom-webmcp.pages.dev`.
4. The rows are already `Published=TRUE` and `Status=active`, so they land on
   the Online Store. Smart collections are **not** part of a CSV import; create
   them by hand or run `pnpm shop:seed` afterwards.
5. Run `pnpm shop:variants --write` to build the map. It only reads, so an app
   with just `read_products` is enough for this path.

## Connect OpenRoom to this store

To make this store the build default, add these public values to `.env.local`
at the repository root:

```bash
NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
NEXT_PUBLIC_SHOPIFY_VARIANTS=…      # written by pnpm shop:variants --write
NEXT_PUBLIC_SITE_ORIGIN=https://openroom.example
```

The domain is what makes the build connected; without one, OpenRoom is
unconfigured. The variant map and site origin are optional. These build values
are **inlined at build time**, so rebuild after changing any of them:

```bash
pnpm build          # or pnpm build:pages for the static export
```

The header store chip can switch the running page without a rebuild. It shows
the connected domain, or **Connect a store** when unconfigured. Saving an
address normalizes it, probes the store's cart tools, and remembers it in this
browser; **Use the sample store** clears that choice and returns to the build
default.

When connected, the approval sheet opens locally for every
`add_scene_to_cart`. **Continue to Shopify** opens
`https://<store>/cart/<variantNumericId>:<qty>,…` in a new tab; products with no
mapping are listed as `Not mapped to a Shopify variant`, and a room with no
mapped variants offers per-product handle links instead. The tool's
`draft.commerce` block carries the same lines plus `mcpEndpoint`
(`https://<store>/api/ucp/mcp`) and a link for every requested product.

OpenRoom's only external request is the unauthenticated `tools/list` probe sent
when a person presses **Save** in the store popover. It sends no credential.
Page load, editing, product search, and `add_scene_to_cart` issue no request to
the store.

Shopify stopped serving the old `/api/mcp` cart tools on 31 August 2026; that
endpoint now lists only `search_shop_policies_and_faqs`, and `get_cart` answers
with a deprecation notice. The replacement at `/api/ucp/mcp` carries
`search_catalog`, `get_product`, `create_cart`, `update_cart`, `get_cart`, and
the checkout tools. Every call to it has to name a publicly fetchable UCP agent
profile in `params.arguments.meta["ucp-agent"].profile`. OpenRoom publishes one
at `public/ucp/agent-profile.json`, and reports its absolute URL as
`draft.commerce.agentProfileUrl` when `NEXT_PUBLIC_SITE_ORIGIN` is set to the
origin the build is served from. Without that variable the field is `null` and
the agent has to bring its own profile.

A password-protected development store still answers the cart and checkout
tools, so the whole handoff can be exercised before the store is public. Only
`search_catalog` comes back empty, because an unlisted storefront has no
catalog to search — which costs OpenRoom nothing, since it hands the agent
variant ids rather than a search query.

`pnpm run test:e2e:commerce` exercises that journey against a stubbed store
domain. It never touches a real store, so it stays useful before and after you
seed one.

## What the seed does

Per catalog product, in catalog order and strictly sequentially:

1. Looks the handle up (`products(first: 1, query: "handle:<id>")`). The
   OpenRoom product id is the Shopify handle **and** the variant SKU.
2. Sends `productSet(synchronous: true, …)` — create when the handle is new,
   update by `identifier: { id }` when it exists. The input carries the title,
   `descriptionHtml` (the catalog copy plus a `W × D × H cm` line), vendor
   `OpenRoom`, `productType` (the category label, e.g. `Coffee table`), the
   humanised tags (category, material, colour, style), `status: ACTIVE`, one
   `Title / Default Title` option, one variant priced in USD with
   `inventoryPolicy: CONTINUE`, and one file pointing at the deployed cutout.
3. Publishes the product with `publishablePublish` to the `Online Store`
   publication. A permalink 404s for anything unpublished, so this is not
   optional.

Then, once per category, a **smart collection** whose rule is
`TYPE EQUALS <product type>` — `sofa`, `coffee-table`, `rug`, `floor-lamp`,
`chair`, `plant`, `side-table`, `bookshelf` — created only if
`collectionByHandle` finds nothing, and published the same way.

Throttling is handled: HTTP 429 or a GraphQL error with
`extensions.code === "THROTTLED"` waits `Retry-After` seconds (2 by default) and
retries, up to five times.

## Idempotency

Re-running `pnpm shop:seed` is the supported way to push a catalog change. A
product that already carries an image keeps it (no duplicate upload). Every
product is matched by handle and updated in place, so ids, variants, and any
orders against them survive. Collections are created only when missing. Nothing
is ever deleted: a product you remove from `DEMO_PRODUCTS` stays in the store
until you archive it by hand.

`pnpm shop:export` is deterministic — same catalog, byte-identical
`products.json` and `products.csv`. A unit test compares the checked-in files
against the live catalog, so a catalog change that is not re-exported fails
`pnpm test`.

## Making it look like a shop

Seeding fills the store with products, but a seeded store still reads as a
product dump: no theme of its own, bare collections, no menus, no pages. The
rest of this folder closes that gap.

```bash
pnpm shop:theme:pull      # pull the live theme into examples/shopify/theme
pnpm shop:theme:check     # schema and Liquid lint — run before every push
pnpm shop:theme:dev       # local preview against the store
pnpm shop:theme:create    # first push: creates the unpublished "OpenRoom (dev)" theme
pnpm shop:theme:push      # every push after that
pnpm shop:collections     # copy, cover image, and sort order on the 8 collections
```

The theme scripts run the Shopify CLI through `pnpm dlx`, so nothing heavy
joins the lockfile. They use the CLI's own browser session and never see
`SHOPIFY_ADMIN_ACCESS_TOKEN`; the first command opens a login page.

**Nothing here pushes to the live theme.** `shop:theme:push` targets an
unpublished theme named `OpenRoom (dev)`, and publishing is a decision you make
in the admin after looking at the preview.

### What is in `theme/`

The store's Horizon theme, pulled and committed so the storefront is
reproducible from this repository. Only two kinds of file are edited — no
Liquid is touched, which keeps the theme upgradable and every change one file
away from being reverted:

| File | Change |
| --- | --- |
| `config/settings_data.json` | The palette from `app/material-tokens.css` — cream `#FBF9F4` page, ink `#1B1C19` text, moss `#4B6543` on every call to action — plus softer corners and quieter display type. |
| `templates/index.json` | The homepage: hero, category grid, sofas, the OpenRoom story, lighting, three promises. |
| `sections/header-group.json` | The announcement bar's text. |
| `sections/footer-group.json` | Two menu columns beside the email signup. |

`templates/collection.json` and `templates/product.json` are left alone: they
already render `{{ closest.collection.description }}` and the product's own
description, so the copy written by `pnpm shop:collections` and by the seeder
shows up without any template work.

The homepage uses no uploaded image. Shopify's Files API needs `write_files`,
which the app does not have, so the hero is a typographic band on the brand's
moss green and the page's imagery comes from the collection covers instead —
those are set from public product URLs, which `write_products` does allow.

### `pnpm shop:collections`

Per category, in catalog order: looks the collection up by handle, then
`collectionUpdate`s it with a one-sentence description, a cover image taken
from the category's dearest product, and `sortOrder: PRICE_ASC`. The copy lives
in `CATEGORY_COPY` in `src/collections.ts`; a category with no sentence written
for it is an error, not a silently bare collection.

It never creates a collection — that is the seeder's job. A collection it
cannot find is reported and skipped, which is what a store that was never
seeded looks like. `--dry-run` prints the plan and sends nothing.

### `pnpm shop:content` — menus and pages

Shopify ships a new store with `main-menu` holding Home / Catalog / Contact and
`footer` holding Search. The theme's header renders whatever `main-menu` holds,
so until it is rewritten the storefront reads as an unfinished template no
matter how good the theme is.

This writes both, and the four pages they link to:

1. Upserts About, Shipping, Returns, and Privacy from `content/pages/*.md` —
   the title comes from each file's `# Heading`, the body from the rest.
2. Resolves the collection and page ids the menu items point at.
3. Rewrites `main-menu` and `footer` **in place**. Updating rather than
   creating matters: the theme is bound to those two handles, and a second menu
   called `main-menu-1` would render nowhere.

Menu items are typed, not hand-written URLs — a category is a `COLLECTION` item
carrying the collection's resource id, so a link to something the store does
not carry fails in the script instead of 404ing for a shopper.

It needs **two scopes beyond the seeder's**:

```text
read_products,write_products,write_publications,write_online_store_navigation,write_online_store_pages
```

Add them in the Dev Dashboard (Versions → scopes → **Release**), reinstall the
app on the store, and mint a fresh token. Without them the Admin API answers
403 and the script says which scopes are missing.

If you would rather not touch the scopes, `content/menus.md` and
`content/pages/` are the same content in readable form — type them into
**Online Store → Navigation** and **Pages**. A unit test keeps `menus.md` and
`src/navigation.ts` agreeing on every collection handle.

The footer's "Shop" column does not depend on any of this: it links the eight
collections directly from the theme, so it works before the menus are written.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `HTTP 401` or `HTTP 403 — check the app's scopes and token` | Most often the 24-hour token simply expired — re-run the client credentials request and update `SHOPIFY_ADMIN_ACCESS_TOKEN`. Otherwise the app is not installed on this store, or its released version lacks `write_products` / `write_publications`. |
| The grant returns a token with an empty `scope` | The Dev Dashboard app has no released version carrying the scopes. Versions tab → enter the scopes → **Release**, then mint the token again. |
| The cart permalink 404s | The product is not published to the Online Store, or is not `ACTIVE`. Re-run `pnpm shop:seed`, which publishes every product, and confirm the store has the Online Store sales channel. |
| `no "Online Store" publication` | That sales channel is not installed in the store. Add it in the store admin under Settings → Apps and sales channels. |
| `Shopify Admin API throttled after 5 retries` | The store's API budget is exhausted. The client already waits `Retry-After` and retries five times; wait a minute and re-run — the seed is idempotent. |
| Products have no image | Shopify could not fetch `Image Src`. Check the URL in `products.json` opens in a browser, and set `OPENROOM_IMAGE_BASE` to a host your store can reach. |
| `missing SHOPIFY_STORE_DOMAIN, …` (exit code 2) | The keys are not in the environment or in `.env.local` at the repository root. |
| `<handle> is not in the store — run pnpm shop:seed` | `pnpm shop:variants` found no product at that handle. Seed first, or import the CSV. |
| `Theme Check` reports `JSONMissingBlock` | A block type in a template JSON is not allowed by its parent block's schema. Read the parent's `{% schema %}` in `theme/blocks/` — static blocks are keyed by their own name and stay out of `block_order`. |
| A setting silently reverts in the theme editor | Its value is not one of the options in `theme/config/settings_schema.json`. Theme Check does not validate setting values; compare against the schema before pushing. |
| `pnpm shop:collections` says a collection is missing | The store was never seeded, or the category is new. Run `pnpm shop:seed` first — this script never creates collections. |

## Safety

- The Admin API token, and the client credentials it is minted from, are read
  from the environment or from `.env.local` at the repository root, which
  `.gitignore` excludes. No script ever prints a value — only key names appear
  in error messages. A token from the client credentials grant expires on its
  own after 24 hours, which limits the damage of a leaked one; the client
  secret does not, so treat it as the real credential.
- OpenRoom itself never holds the token. Its build default and browser-stored
  choice are public store domains. The app issues only an unauthenticated
  `tools/list` request when a person saves the store chip; page load, editing,
  and `add_scene_to_cart` issue none.
- Nothing in this folder runs in CI, and no test here reaches the network: the
  unit suite drives a fake Admin client, and `--dry-run` sends nothing.
- Point this at a **development store**. It writes products, and it is not a
  migration tool for a live shop.
