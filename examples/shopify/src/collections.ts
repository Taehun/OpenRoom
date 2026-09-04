/**
 * Copy, cover art, and sort order for the eight category collections.
 *
 * `pnpm shop:seed` creates the collections but leaves them bare: no
 * description, no image, and Shopify's default ordering. A bare collection
 * reads as a seeded dump rather than a shop, and the homepage's category grid
 * has nothing to show, so this module supplies the missing presentation.
 *
 * The planning half is pure — no `fetch`, no file system, no environment — and
 * the covers are chosen from the catalog itself, so a category can never
 * advertise a product the store does not carry. Only `decorateCollections`
 * talks to the Admin API, through the client it is handed.
 */
import type { AdminClient } from "./admin-client";
import type { ShopProduct } from "./catalog";
import { COLLECTION_BY_HANDLE_QUERY, collectionHandle, type UserError } from "./seed";

/**
 * One sentence per category, written to sit under the collection banner that
 * `templates/collection.json` already renders. Keyed by Shopify's product
 * type, which is what the smart collections match on.
 */
export const CATEGORY_COPY: Readonly<Record<string, string>> = {
  Sofa: "Low frames and soft edges, sized so the walkway in front of them survives.",
  Chair:
    "Occasional seating that holds its own beside a sofa, or stands alone by a window.",
  "Coffee table":
    "The piece a room arranges itself around — low, central, and easy to walk past.",
  "Side table":
    "Somewhere for the lamp, the book, and the cup, within reach of where you sit.",
  Bookshelf: "Open storage that backs onto a wall and gives a room its vertical line.",
  "Floor lamp": "Light at standing height, for the corners a ceiling fixture never reaches.",
  Rug: "The layer that sets a room's footprint and tells the furniture where to stop.",
  Plant: "Height, texture, and a little disorder, in the corner nothing else wanted.",
};

/** Collections are ordered cheapest first: a dev store has no sales history. */
export const COLLECTION_SORT_ORDER = "PRICE_ASC" as const;

export interface CollectionDecoration {
  /** Shopify's product type, and the key into {@link CATEGORY_COPY}. */
  productType: string;
  /** Matches the handle `pnpm shop:seed` created the collection with. */
  handle: string;
  title: string;
  descriptionHtml: string;
  /** The cover image, taken from one of the category's own products. */
  imageUrl: string;
  imageAlt: string;
  sortOrder: typeof COLLECTION_SORT_ORDER;
}

export interface CollectionInput {
  id: string;
  title: string;
  descriptionHtml: string;
  sortOrder: typeof COLLECTION_SORT_ORDER;
  image: { src: string; altText: string };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The dearest product in a category. The flagship piece photographs the
 * category better than the cheapest one, and the choice stays stable as long
 * as prices do.
 */
function coverFor(members: readonly ShopProduct[]): ShopProduct {
  return members.reduce((best, product) =>
    Number(product.priceUsd) > Number(best.priceUsd) ? product : best,
  );
}

/**
 * One decoration per category, in the order the categories first appear in the
 * catalog. A category with no copy written for it is an error rather than a
 * collection that silently keeps its bare description.
 */
export function planCollectionDecorations(
  catalog: readonly ShopProduct[],
): CollectionDecoration[] {
  const byType = new Map<string, ShopProduct[]>();
  for (const product of catalog) {
    const members = byType.get(product.productType);
    if (members) members.push(product);
    else byType.set(product.productType, [product]);
  }

  return [...byType].map(([productType, members]) => {
    const copy = CATEGORY_COPY[productType];
    if (copy === undefined) {
      throw new Error(
        `no collection copy written for ${productType}; add it to CATEGORY_COPY in examples/shopify/src/collections.ts`,
      );
    }
    const cover = coverFor(members);
    return {
      productType,
      handle: collectionHandle(productType),
      title: productType,
      descriptionHtml: `<p>${escapeHtml(copy)}</p>`,
      imageUrl: cover.imageUrl,
      imageAlt: productType,
      sortOrder: COLLECTION_SORT_ORDER,
    };
  });
}

/**
 * The `collectionUpdate` input for one decoration. The handle is deliberately
 * absent: the collection already has the URL the homepage links to, and
 * resending it risks Shopify suffixing a duplicate.
 */
export function buildCollectionInput(
  collectionId: string,
  plan: CollectionDecoration,
): CollectionInput {
  return {
    id: collectionId,
    title: plan.title,
    descriptionHtml: plan.descriptionHtml,
    sortOrder: plan.sortOrder,
    image: { src: plan.imageUrl, altText: plan.imageAlt },
  };
}

export const COLLECTION_UPDATE_MUTATION = `mutation CollectionUpdate($input: CollectionInput!) {
  collectionUpdate(input: $input) {
    collection { id handle }
    userErrors { field message }
  }
}`;

export interface DecorateOptions {
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface DecoratedCollection {
  handle: string;
  collectionId: string | null;
  /** True when the collection was found and updated; false when it is missing. */
  updated: boolean;
}

export interface DecorateResult {
  collections: DecoratedCollection[];
}

function failOnUserErrors(label: string, errors: readonly UserError[] | undefined): void {
  const messages = (errors ?? []).map((error) => error.message);
  if (messages.length > 0) {
    throw new Error(`${label}: ${messages.join("; ")}`);
  }
}

/**
 * Writes the copy, cover, and sort order onto every category collection that
 * `pnpm shop:seed` created. A collection that does not exist yet is reported
 * and skipped rather than created here — creating collections is the seeder's
 * job, and quietly doing it twice would hide a store that was never seeded.
 */
export async function decorateCollections(
  client: AdminClient,
  catalog: readonly ShopProduct[],
  options: DecorateOptions = {},
): Promise<DecorateResult> {
  const log = options.log ?? (() => {});
  const plans = planCollectionDecorations(catalog);

  if (options.dryRun === true) {
    log(`[collections] dry run — no request is sent to ${client.endpoint}`);
    for (const plan of plans) {
      log(
        `[collections] ${plan.handle} would get: sort=${plan.sortOrder} ` +
          `cover=${plan.imageUrl} copy=${JSON.stringify(plan.descriptionHtml)}`,
      );
    }
    log(`[collections] dry run complete: ${plans.length} collections, 0 requests`);
    return { collections: plans.map((plan) => ({ handle: plan.handle, collectionId: null, updated: false })) };
  }

  const collections: DecoratedCollection[] = [];
  for (const plan of plans) {
    const found = await client.query<{ collectionByHandle: { id: string } | null }>(
      COLLECTION_BY_HANDLE_QUERY,
      { handle: plan.handle },
    );
    const collectionId = found.collectionByHandle?.id ?? null;
    if (collectionId === null) {
      log(`[collections] ${plan.handle} not found — run pnpm shop:seed first`);
      collections.push({ handle: plan.handle, collectionId: null, updated: false });
      continue;
    }

    const result = await client.query<{
      collectionUpdate: { collection: { id: string } | null; userErrors: UserError[] };
    }>(COLLECTION_UPDATE_MUTATION, { input: buildCollectionInput(collectionId, plan) });
    failOnUserErrors(`collectionUpdate ${plan.handle}`, result.collectionUpdate.userErrors);

    collections.push({ handle: plan.handle, collectionId, updated: true });
    log(`[collections] ${plan.handle} updated → cover ${plan.imageUrl}`);
  }

  return { collections };
}
