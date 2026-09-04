# Shopify furniture store seed kit

OpenRoom's `shopify` mode is token-free: it builds a cart permalink and points
agents at the store's Storefront MCP endpoint, and it never holds a credential.
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

- A **Shopify Partner development store**. Create one at
  <https://partners.shopify.com> → Stores → Add store → Development store.
- A **custom app** in that store: Settings → Apps and sales channels → Develop
  apps → Create an app. Under **Configuration → Admin API integration** grant
  exactly these scopes:

  ```text
  read_products, write_products, write_publications
  ```

  Then **Install app** and reveal the **Admin API access token** (`shpat_…`).
  It is shown once.
- The **Online Store** sales channel enabled in that store. The seeder looks for
  a publication named `Online Store` and stops if there is none.
- Node 24.13.1 and pnpm 10.27.0 (the versions in `package.json` and
  `.node-version`), with `pnpm install --frozen-lockfile` already run.

Copy this folder's `.env.example` into `.env.local` **at the repository root**
(that file is git-ignored) and fill in the two required values:

```bash
cat examples/shopify-furniture-store/.env.example >> .env.local
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `SHOPIFY_STORE_DOMAIN` | yes | `your-store.myshopify.com`, no scheme. |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | yes | The custom app's Admin API token. Never commit it. |
| `SHOPIFY_API_VERSION` | no | Admin GraphQL version; defaults to `2026-01`. |
| `OPENROOM_IMAGE_BASE` | no | Host the cutouts are fetched from; defaults to `https://openroom-y20.pages.dev`. |

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

If you would rather not create an Admin API token, `products.csv` is a plain
Shopify import file (it is checked in, so no command is needed to obtain it).

1. In the store admin go to **Products → Import**.
2. Upload `examples/shopify-furniture-store/products.csv` and confirm.
3. Shopify fetches each `Image Src` from the public URL, so the store needs
   outbound access to `https://openroom-y20.pages.dev`.
4. The rows are already `Published=TRUE` and `Status=active`, so they land on
   the Online Store. Smart collections are **not** part of a CSV import; create
   them by hand or run `pnpm shop:seed` afterwards.
5. Run `pnpm shop:variants --write` to build the map — it only reads, so a
   read-only token is enough for this path.

## Switch OpenRoom to Shopify mode

Add these three to `.env.local` at the repository root:

```bash
NEXT_PUBLIC_COMMERCE_PROVIDER=shopify
NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
NEXT_PUBLIC_SHOPIFY_VARIANTS=…      # written by pnpm shop:variants --write
```

All three are **inlined at build time**, so rebuild after changing any of them:

```bash
pnpm build          # or pnpm build:pages for the static export
```

In `shopify` mode the approval sheet still opens locally for every
`add_scene_to_cart`, and OpenRoom still makes no external request. **Continue to
Shopify** opens `https://<store>/cart/<variantNumericId>:<qty>,…` in a new tab;
products with no mapping are listed as `Not mapped to a Shopify variant` and
left out. The tool's `draft.commerce` block carries the same lines plus
`mcpEndpoint` (`https://<store>/api/mcp`) for an agent that would rather drive
the store's Storefront MCP server.

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

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `HTTP 401` or `HTTP 403 — check the app's scopes and token` | The token is wrong, revoked, or the app lacks `read_products`, `write_products`, `write_publications`. Re-check Configuration → Admin API integration, reinstall the app, and copy the token again. |
| The cart permalink 404s | The product is not published to the Online Store, or is not `ACTIVE`. Re-run `pnpm shop:seed`, which publishes every product, and confirm the store has the Online Store sales channel. |
| `no "Online Store" publication` | That sales channel is not installed in the store. Add it in Settings → Apps and sales channels. |
| `Shopify Admin API throttled after 5 retries` | The store's API budget is exhausted. The client already waits `Retry-After` and retries five times; wait a minute and re-run — the seed is idempotent. |
| Products have no image | Shopify could not fetch `Image Src`. Check the URL in `products.json` opens in a browser, and set `OPENROOM_IMAGE_BASE` to a host your store can reach. |
| `missing SHOPIFY_STORE_DOMAIN, …` (exit code 2) | The keys are not in the environment or in `.env.local` at the repository root. |
| `<handle> is not in the store — run pnpm shop:seed` | `pnpm shop:variants` found no product at that handle. Seed first, or import the CSV. |

## Safety

- The Admin API token is read from the environment or from `.env.local` at the
  repository root, which `.gitignore` excludes. No script ever prints a value —
  only key names appear in error messages.
- OpenRoom itself never holds the token. The app's Shopify mode is three
  `NEXT_PUBLIC_*` values, all of them public by construction, and it makes no
  request to the store from its own code.
- Nothing in this folder runs in CI, and no test here reaches the network: the
  unit suite drives a fake Admin client, and `--dry-run` sends nothing.
- Point this at a **development store**. It writes products, and it is not a
  migration tool for a live shop.
