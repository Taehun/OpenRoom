import { describe, expect, it } from "vitest";

import {
  CATEGORY_COPY,
  buildCollectionInput,
  decorateCollections,
  planCollectionDecorations,
} from "../../examples/shopify/src/collections";
import type { AdminClient } from "../../examples/shopify/src/admin-client";
import { DEFAULT_IMAGE_BASE, buildShopCatalog } from "../../examples/shopify/src/catalog";
import { collectionHandle } from "../../examples/shopify/src/seed";
import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import { PHOTO_ASSETS } from "../../src/features/photo/photo-assets";

const CATALOG = buildShopCatalog(DEMO_PRODUCTS, PHOTO_ASSETS, DEFAULT_IMAGE_BASE);

describe("planCollectionDecorations", () => {
  it("plans one decoration per category in the catalog", () => {
    const plans = planCollectionDecorations(CATALOG);
    const types = [...new Set(CATALOG.map((product) => product.productType))];

    expect(plans).toHaveLength(types.length);
    expect(plans.map((plan) => plan.productType)).toEqual(types);
  });

  it("uses the same handles the seeder created the collections with", () => {
    for (const plan of planCollectionDecorations(CATALOG)) {
      expect(plan.handle).toBe(collectionHandle(plan.productType));
    }
  });

  it("carries hand-written copy for every category", () => {
    for (const plan of planCollectionDecorations(CATALOG)) {
      expect(plan.title.length).toBeGreaterThan(0);
      expect(plan.descriptionHtml).toMatch(/^<p>.+<\/p>$/);
      // Placeholder copy would defeat the point of the pass.
      expect(plan.descriptionHtml).not.toMatch(/TODO|TBD|lorem/i);
    }
  });

  it("represents each category with the image of one of its own products", () => {
    for (const plan of planCollectionDecorations(CATALOG)) {
      const members = CATALOG.filter((product) => product.productType === plan.productType);
      expect(members.map((product) => product.imageUrl)).toContain(plan.imageUrl);
      expect(plan.imageAlt).toBe(plan.title);
    }
  });

  it("picks the dearest product of a category as its cover", () => {
    // The flagship piece photographs the category better than the cheapest one.
    for (const plan of planCollectionDecorations(CATALOG)) {
      const members = CATALOG.filter((product) => product.productType === plan.productType);
      const dearest = members.reduce((best, product) =>
        Number(product.priceUsd) > Number(best.priceUsd) ? product : best,
      );
      expect(plan.imageUrl).toBe(dearest.imageUrl);
    }
  });

  it("sorts every collection by price, cheapest first", () => {
    for (const plan of planCollectionDecorations(CATALOG)) {
      expect(plan.sortOrder).toBe("PRICE_ASC");
    }
  });

  it("is deterministic", () => {
    expect(planCollectionDecorations(CATALOG)).toEqual(planCollectionDecorations(CATALOG));
  });

  it("throws when a category has no copy written for it", () => {
    const orphan = { ...CATALOG[0], productType: "Hammock" };
    expect(() => planCollectionDecorations([orphan])).toThrow(/Hammock/);
  });
});

describe("CATEGORY_COPY", () => {
  it("covers every category the catalog ships", () => {
    const types = [...new Set(CATALOG.map((product) => product.productType))];
    expect(Object.keys(CATEGORY_COPY).sort()).toEqual([...types].sort());
  });

  it("writes one sentence per category, not a paragraph", () => {
    for (const [type, copy] of Object.entries(CATEGORY_COPY)) {
      expect(copy, type).not.toContain("<");
      expect(copy.length, type).toBeLessThanOrEqual(160);
      expect(copy.endsWith("."), type).toBe(true);
    }
  });
});

describe("buildCollectionInput", () => {
  const [plan] = planCollectionDecorations(CATALOG);

  it("addresses the collection by id and carries the copy", () => {
    const input = buildCollectionInput("gid://shopify/Collection/1", plan);

    expect(input).toMatchObject({
      id: "gid://shopify/Collection/1",
      title: plan.title,
      descriptionHtml: plan.descriptionHtml,
      sortOrder: "PRICE_ASC",
    });
  });

  it("sends the image by URL, the way the seeder sends product media", () => {
    const input = buildCollectionInput("gid://shopify/Collection/1", plan);

    expect(input.image).toEqual({ src: plan.imageUrl, altText: plan.imageAlt });
  });

  it("never sends the handle, so an existing collection keeps its URL", () => {
    expect(buildCollectionInput("gid://shopify/Collection/1", plan)).not.toHaveProperty("handle");
  });
});

interface FakeCall {
  document: string;
  variables: Record<string, unknown>;
}

/** Answers the two documents `decorateCollections` sends, and records both. */
function createFakeClient(missing: readonly string[] = []): {
  client: AdminClient;
  calls: FakeCall[];
} {
  const absent = new Set(missing);
  const calls: FakeCall[] = [];
  const client: AdminClient = {
    endpoint: "https://fake-store.myshopify.com/admin/api/2026-01/graphql.json",
    async query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
      calls.push({ document, variables });
      if (document.includes("query CollectionByHandle")) {
        const handle = String(variables.handle);
        return {
          collectionByHandle: absent.has(handle)
            ? null
            : { id: `gid://shopify/Collection/${handle}`, handle },
        } as T;
      }
      if (document.includes("mutation CollectionUpdate")) {
        const input = variables.input as { id: string };
        return {
          collectionUpdate: { collection: { id: input.id }, userErrors: [] },
        } as T;
      }
      throw new Error(`unexpected document: ${document.slice(0, 40)}`);
    },
  };
  return { client, calls };
}

describe("decorateCollections", () => {
  it("sends nothing on a dry run", async () => {
    const { client, calls } = createFakeClient();
    const result = await decorateCollections(client, CATALOG, { dryRun: true });

    expect(calls).toHaveLength(0);
    expect(result.collections.every((entry) => !entry.updated)).toBe(true);
    expect(result.collections).toHaveLength(planCollectionDecorations(CATALOG).length);
  });

  it("looks each collection up by handle and updates it", async () => {
    const { client, calls } = createFakeClient();
    const result = await decorateCollections(client, CATALOG);
    const plans = planCollectionDecorations(CATALOG);

    expect(result.collections.map((entry) => entry.handle)).toEqual(
      plans.map((plan) => plan.handle),
    );
    expect(result.collections.every((entry) => entry.updated)).toBe(true);
    expect(calls).toHaveLength(plans.length * 2);
  });

  it("carries the planned copy, cover, and sort order into the mutation", async () => {
    const { client, calls } = createFakeClient();
    await decorateCollections(client, CATALOG);
    const [plan] = planCollectionDecorations(CATALOG);
    const update = calls.find((call) => call.document.includes("mutation CollectionUpdate"));

    expect(update?.variables.input).toEqual(
      buildCollectionInput(`gid://shopify/Collection/${plan.handle}`, plan),
    );
  });

  it("skips a collection the seeder never created instead of creating it", async () => {
    const { client, calls } = createFakeClient(["rug"]);
    const result = await decorateCollections(client, CATALOG);
    const rug = result.collections.find((entry) => entry.handle === "rug");

    expect(rug).toEqual({ handle: "rug", collectionId: null, updated: false });
    expect(calls.some((call) => call.document.includes("CollectionCreate"))).toBe(false);
  });

  it("fails loudly on a userErrors response", async () => {
    const client: AdminClient = {
      endpoint: "https://fake-store.myshopify.com/admin/api/2026-01/graphql.json",
      async query<T>(document: string): Promise<T> {
        if (document.includes("query CollectionByHandle")) {
          return { collectionByHandle: { id: "gid://shopify/Collection/1" } } as T;
        }
        return {
          collectionUpdate: {
            collection: null,
            userErrors: [{ field: ["image"], message: "Image could not be fetched" }],
          },
        } as T;
      },
    };

    await expect(decorateCollections(client, CATALOG)).rejects.toThrow(
      /collectionUpdate .*Image could not be fetched/,
    );
  });
});
