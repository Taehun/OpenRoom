# Shopify furniture store seed kit

OpenRoom's `shopify` mode is token-free: it builds a cart permalink and points
agents at the store's UCP MCP endpoint, and it never holds a credential.
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
   read_products,write_products,write_publications
   ```

   Then select **Release**. Without a released version the scopes are not
   granted, and the token below comes back with an empty `scope`.
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
`mcpEndpoint` (`https://<store>/api/ucp/mcp`) for an agent that would rather
build the cart itself.

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

## Safety

- The Admin API token, and the client credentials it is minted from, are read
  from the environment or from `.env.local` at the repository root, which
  `.gitignore` excludes. No script ever prints a value — only key names appear
  in error messages. A token from the client credentials grant expires on its
  own after 24 hours, which limits the damage of a leaked one; the client
  secret does not, so treat it as the real credential.
- OpenRoom itself never holds the token. The app's Shopify mode is three
  `NEXT_PUBLIC_*` values, all of them public by construction, and it makes no
  request to the store from its own code.
- Nothing in this folder runs in CI, and no test here reaches the network: the
  unit suite drives a fake Admin client, and `--dry-run` sends nothing.
- Point this at a **development store**. It writes products, and it is not a
  migration tool for a live shop.
