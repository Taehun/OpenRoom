/**
 * The seed plan and the runner that executes it.
 *
 * The planners are pure — they turn a `ShopProduct` into the exact GraphQL
 * document and variables that would be sent — so `--dry-run` and the unit
 * tests exercise the same values the real run would. `seedStore` is the only
 * part that talks to a store, and in dry-run mode it makes no request at all.
 */
import type { ShopProduct } from "./catalog";
import type { AdminClient } from "./admin-client";

export interface GraphQLPlan {
  query: string;
  variables: Record<string, unknown>;
}

export const PUBLICATIONS_QUERY = `query Publications {
  publications(first: 20) { nodes { id name } }
}`;

export const PRODUCT_BY_HANDLE_QUERY = `query ProductByHandle($q: String!) {
  products(first: 1, query: $q) {
    nodes { id handle variants(first: 1) { nodes { id } } }
  }
}`;

const PRODUCT_SET_FIELDS = `product { id handle variants(first: 1) { nodes { id } } }
    userErrors { field message }`;

export const PRODUCT_SET_CREATE_MUTATION = `mutation ProductSetCreate($input: ProductSetInput!) {
  productSet(synchronous: true, input: $input) {
    ${PRODUCT_SET_FIELDS}
  }
}`;

export const PRODUCT_SET_UPDATE_MUTATION = `mutation ProductSetUpdate($input: ProductSetInput!, $identifier: ProductSetIdentifiers!) {
  productSet(synchronous: true, input: $input, identifier: $identifier) {
    ${PRODUCT_SET_FIELDS}
  }
}`;

export const PUBLISHABLE_PUBLISH_MUTATION = `mutation PublishablePublish($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) { userErrors { field message } }
}`;

export const COLLECTION_BY_HANDLE_QUERY = `query CollectionByHandle($handle: String!) {
  collectionByHandle(handle: $handle) { id handle }
}`;

export const COLLECTION_CREATE_MUTATION = `mutation CollectionCreate($input: CollectionInput!) {
  collectionCreate(input: $input) {
    collection { id handle }
    userErrors { field message }
  }
}`;

export const ONLINE_STORE_PUBLICATION = "Online Store";

export interface UserError {
  field?: string[] | null;
  message: string;
}

interface PublicationsData {
  publications: { nodes: { id: string; name: string }[] };
}

interface ProductNode {
  id: string;
  handle: string;
  variants: { nodes: { id: string }[] };
}

interface ProductByHandleData {
  products: { nodes: ProductNode[] };
}

interface ProductSetData {
  productSet: { product: ProductNode | null; userErrors: UserError[] };
}

interface PublishData {
  publishablePublish: { userErrors: UserError[] };
}

interface CollectionByHandleData {
  collectionByHandle: { id: string; handle: string } | null;
}

interface CollectionCreateData {
  collectionCreate: {
    collection: { id: string; handle: string } | null;
    userErrors: UserError[];
  };
}

export interface CollectionPlan {
  handle: string;
  title: string;
  productType: string;
  query: string;
  variables: Record<string, unknown>;
}

export interface SeededProduct {
  handle: string;
  productId: string | null;
  variantId: string | null;
  created: boolean;
}

export interface SeededCollection {
  handle: string;
  collectionId: string | null;
  created: boolean;
}

export interface SeedResult {
  publicationId: string | null;
  products: SeededProduct[];
  collections: SeededCollection[];
}

export interface SeedOptions {
  dryRun?: boolean;
  log?: (message: string) => void;
}

/** "Coffee table" → "coffee-table", which is also the category slug. */
export function collectionHandle(productType: string): string {
  return productType
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The `productSet` call for one product. With `existingId` it updates that
 * product by id; without one it creates a product at the catalog handle.
 */
export function planProductSet(
  product: ShopProduct,
  existingId: string | null,
): GraphQLPlan {
  const input = {
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    status: "ACTIVE",
    productOptions: [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }],
    variants: [
      {
        optionValues: [{ optionName: "Title", name: "Default Title" }],
        price: product.priceUsd,
        sku: product.sku,
        inventoryPolicy: "CONTINUE",
      },
    ],
    files: [
      {
        originalSource: product.imageUrl,
        alt: product.imageAlt,
        filename: `${product.handle}.webp`,
        contentType: "IMAGE",
      },
    ],
  };

  return existingId === null
    ? { query: PRODUCT_SET_CREATE_MUTATION, variables: { input } }
    : {
        query: PRODUCT_SET_UPDATE_MUTATION,
        variables: { input, identifier: { id: existingId } },
      };
}

/** One smart collection per category, matching on Shopify's product type. */
export function planCollections(catalog: readonly ShopProduct[]): CollectionPlan[] {
  const plans: CollectionPlan[] = [];
  for (const product of catalog) {
    const { productType } = product;
    if (plans.some((plan) => plan.productType === productType)) continue;
    plans.push({
      handle: collectionHandle(productType),
      title: productType,
      productType,
      query: COLLECTION_CREATE_MUTATION,
      variables: {
        input: {
          title: productType,
          handle: collectionHandle(productType),
          descriptionHtml: `<p>Every ${productType.toLowerCase()} in the OpenRoom catalog.</p>`,
          ruleSet: {
            appliedDisjunctively: false,
            rules: [{ column: "TYPE", relation: "EQUALS", condition: productType }],
          },
        },
      },
    });
  }
  return plans;
}

function failOnUserErrors(step: string, errors: readonly UserError[]): void {
  if (errors.length === 0) return;
  const detail = errors
    .map((error) => `${(error.field ?? []).join(".") || "-"}: ${error.message}`)
    .join("; ");
  throw new Error(`${step} failed: ${detail}`);
}

async function findOnlineStorePublication(client: AdminClient): Promise<string> {
  const data = await client.query<PublicationsData>(PUBLICATIONS_QUERY);
  const publication = data.publications.nodes.find(
    (node) => node.name === ONLINE_STORE_PUBLICATION,
  );
  if (!publication) {
    throw new Error(
      `no "${ONLINE_STORE_PUBLICATION}" publication — add the Online Store sales channel to this store`,
    );
  }
  return publication.id;
}

async function findProductByHandle(
  client: AdminClient,
  handle: string,
): Promise<ProductNode | null> {
  const data = await client.query<ProductByHandleData>(PRODUCT_BY_HANDLE_QUERY, {
    q: `handle:${handle}`,
  });
  return data.products.nodes.find((node) => node.handle === handle) ?? null;
}

/**
 * Upserts every product by handle, publishes it to the Online Store, then
 * creates any missing category collection and publishes that. Products run
 * sequentially so a large catalog stays inside the Admin API's cost budget.
 */
export async function seedStore(
  client: AdminClient,
  catalog: readonly ShopProduct[],
  options: SeedOptions = {},
): Promise<SeedResult> {
  const log = options.log ?? (() => {});
  const collectionPlans = planCollections(catalog);

  if (options.dryRun === true) {
    log(`[seed] dry run — no request is sent to ${client.endpoint}`);
    for (const product of catalog) {
      log(
        `[seed] ${product.handle} would be created or updated: type=${product.productType} ` +
          `price=${product.priceUsd} tags=${product.tags.length} image=${product.imageUrl}`,
      );
    }
    for (const plan of collectionPlans) {
      log(`[seed] collection ${plan.handle} would be created if missing (TYPE = ${plan.productType})`);
    }
    const example = catalog[0];
    if (example) {
      log(
        `[seed] example productSet variables: ${JSON.stringify(planProductSet(example, null).variables)}`,
      );
    }
    log(
      `[seed] dry run complete: ${catalog.length} products, ${collectionPlans.length} collections, 0 requests`,
    );
    return {
      publicationId: null,
      products: catalog.map((product) => ({
        handle: product.handle,
        productId: null,
        variantId: null,
        created: false,
      })),
      collections: collectionPlans.map((plan) => ({
        handle: plan.handle,
        collectionId: null,
        created: false,
      })),
    };
  }

  const publicationId = await findOnlineStorePublication(client);
  const products: SeededProduct[] = [];

  for (const product of catalog) {
    const existing = await findProductByHandle(client, product.handle);
    const plan = planProductSet(product, existing?.id ?? null);
    const result = await client.query<ProductSetData>(plan.query, plan.variables);
    failOnUserErrors(`productSet ${product.handle}`, result.productSet.userErrors);
    const node = result.productSet.product;
    if (!node) {
      throw new Error(`productSet ${product.handle} returned no product`);
    }
    const variantId = node.variants.nodes[0]?.id ?? null;

    const published = await client.query<PublishData>(PUBLISHABLE_PUBLISH_MUTATION, {
      id: node.id,
      input: [{ publicationId }],
    });
    failOnUserErrors(`publish ${product.handle}`, published.publishablePublish.userErrors);

    products.push({
      handle: product.handle,
      productId: node.id,
      variantId,
      created: existing === null,
    });
    log(
      `[seed] ${product.handle} ${existing === null ? "created" : "updated"} → ${variantId ?? "no variant"}`,
    );
  }

  const collections: SeededCollection[] = [];
  for (const plan of collectionPlans) {
    const found = await client.query<CollectionByHandleData>(COLLECTION_BY_HANDLE_QUERY, {
      handle: plan.handle,
    });
    let collectionId = found.collectionByHandle?.id ?? null;
    const created = collectionId === null;
    if (created) {
      const result = await client.query<CollectionCreateData>(plan.query, plan.variables);
      failOnUserErrors(`collectionCreate ${plan.handle}`, result.collectionCreate.userErrors);
      collectionId = result.collectionCreate.collection?.id ?? null;
    }
    if (collectionId !== null) {
      const published = await client.query<PublishData>(PUBLISHABLE_PUBLISH_MUTATION, {
        id: collectionId,
        input: [{ publicationId }],
      });
      failOnUserErrors(`publish ${plan.handle}`, published.publishablePublish.userErrors);
    }
    collections.push({ handle: plan.handle, collectionId, created });
    log(`[seed] collection ${plan.handle} ${created ? "created" : "exists"}`);
  }

  return { publicationId, products, collections };
}
