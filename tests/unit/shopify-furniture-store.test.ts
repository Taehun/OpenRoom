import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_BASE,
  buildShopCatalog,
  csvField,
  priceFromMinor,
  toShopifyCsv,
  type ShopProduct,
} from "../../examples/shopify-furniture-store/src/catalog";
import {
  adminEndpoint,
  createAdminClient,
  type AdminClient,
} from "../../examples/shopify-furniture-store/src/admin-client";
import {
  collectionHandle,
  planCollections,
  planProductSet,
  seedStore,
} from "../../examples/shopify-furniture-store/src/seed";
import {
  buildVariantsEnvLine,
  fetchStoreVariants,
  upsertEnvLine,
} from "../../examples/shopify-furniture-store/src/variants";
import { parseEnvFile, requireEnv } from "../../examples/shopify-furniture-store/src/env";
import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import { PHOTO_ASSETS } from "../../src/features/photo/photo-assets";
import { parseVariantOverrides } from "../../src/features/commerce/shopify-variants";

const CATALOG = buildShopCatalog(DEMO_PRODUCTS, PHOTO_ASSETS, DEFAULT_IMAGE_BASE);

/** Vitest runs from the repository root, so the kit is a fixed relative path. */
const EXAMPLE_DIR = join(process.cwd(), "examples", "shopify-furniture-store");

function readExample(name: string): string {
  return readFileSync(join(EXAMPLE_DIR, name), "utf8");
}

interface FakeClientOptions {
  existingProducts?: readonly string[];
  existingCollections?: readonly string[];
}

interface FakeCall {
  document: string;
  variables: Record<string, unknown>;
}

function productNode(handle: string) {
  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    variants: { nodes: [{ id: `gid://shopify/ProductVariant/${handle}` }] },
    // An existing product already carries its cutout.
    media: { nodes: [{ id: `gid://shopify/MediaImage/${handle}` }] },
  };
}

/** Records every document it is handed and answers with canned Admin API shapes. */
function createFakeClient(options: FakeClientOptions = {}): {
  client: AdminClient;
  calls: FakeCall[];
} {
  const existingProducts = new Set(options.existingProducts ?? []);
  const existingCollections = new Set(options.existingCollections ?? []);
  const calls: FakeCall[] = [];

  const client: AdminClient = {
    endpoint: "https://fake-store.myshopify.com/admin/api/2026-01/graphql.json",
    async query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
      calls.push({ document, variables });
      const answer = ((): unknown => {
        if (document.includes("query Publications")) {
          return {
            publications: {
              nodes: [
                { id: "gid://shopify/Publication/9", name: "Point of Sale" },
                { id: "gid://shopify/Publication/1", name: "Online Store" },
              ],
            },
          };
        }
        if (document.includes("query ProductByHandle")) {
          const handle = String(variables.q).replace("handle:", "");
          return {
            products: { nodes: existingProducts.has(handle) ? [productNode(handle)] : [] },
          };
        }
        if (document.includes("mutation ProductSet")) {
          const input = variables.input as { handle: string };
          return { productSet: { product: productNode(input.handle), userErrors: [] } };
        }
        if (document.includes("mutation PublishablePublish")) {
          return { publishablePublish: { userErrors: [] } };
        }
        if (document.includes("query CollectionByHandle")) {
          const handle = String(variables.handle);
          return {
            collectionByHandle: existingCollections.has(handle)
              ? { id: `gid://shopify/Collection/${handle}`, handle }
              : null,
          };
        }
        if (document.includes("mutation CollectionCreate")) {
          const input = variables.input as { handle: string };
          return {
            collectionCreate: {
              collection: { id: `gid://shopify/Collection/${input.handle}`, handle: input.handle },
              userErrors: [],
            },
          };
        }
        throw new Error(`unexpected document: ${document}`);
      })();
      return answer as T;
    },
  };

  return { client, calls };
}

function fixtureCatalog(): ShopProduct[] {
  const ids = ["hinoki-low-sofa", "boucle-curve-sofa", "oak-frame-table"];
  return buildShopCatalog(
    DEMO_PRODUCTS.filter((product) => ids.includes(product.id)),
    PHOTO_ASSETS,
    DEFAULT_IMAGE_BASE,
  );
}

describe("buildShopCatalog", () => {
  it("covers the whole demo catalog and gives every handle an image under the base", () => {
    expect(CATALOG).toHaveLength(43);
    expect(CATALOG).toHaveLength(DEMO_PRODUCTS.length);
    for (const product of CATALOG) {
      expect(product.imageUrl).toBe(
        `${DEFAULT_IMAGE_BASE}/demo/photo/products/${product.handle}.webp`,
      );
      expect(product.vendor).toBe("OpenRoom");
      expect(product.sku).toBe(product.handle);
      expect(product.priceUsd).toMatch(/^\d+\.\d{2}$/);
      expect(product.tags.length).toBeGreaterThan(0);
    }
  });

  it("labels the type, humanises the tags, and prints the size in the description", () => {
    const sofa = CATALOG.find((product) => product.handle === "hinoki-low-sofa")!;
    expect(sofa.productType).toBe("Sofa");
    expect(sofa.tags).toEqual([
      "Sofa",
      "Hinoki and linen",
      "Natural cream",
      "Japandi",
      "Light wood",
      "Low profile",
    ]);
    expect(sofa.descriptionHtml).toBe(
      "<p>A low hinoki frame with calm linen cushions and soft edges.</p><p>W 210 × D 92 × H 72 cm</p>",
    );
    expect(sofa.priceUsd).toBe("1899.00");
  });

  it("deduplicates a colour that repeats the material", () => {
    const table = CATALOG.find((product) => product.handle === "walnut-nesting-table")!;
    expect(table.tags).toEqual(["Coffee table", "Walnut", "Mid century", "Warm walnut"]);
  });

  it("refuses a product with no registered cutout", () => {
    expect(() => buildShopCatalog(DEMO_PRODUCTS, {}, DEFAULT_IMAGE_BASE)).toThrow(
      /no cutout registered/,
    );
  });

  it("formats cents as a decimal string", () => {
    expect(priceFromMinor(189900)).toBe("1899.00");
    expect(priceFromMinor(21900)).toBe("219.00");
    expect(priceFromMinor(5)).toBe("0.05");
  });
});

describe("toShopifyCsv", () => {
  const csv = toShopifyCsv(CATALOG);
  const lines = csv.split("\n");

  it("writes a header and one row per product", () => {
    expect(lines).toHaveLength(44);
    expect(lines[0]).toBe(
      "Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value," +
        "Variant SKU,Variant Inventory Policy,Variant Fulfillment Service,Variant Price," +
        "Variant Requires Shipping,Variant Taxable,Image Src,Image Alt Text,Status",
    );
  });

  it("quotes a description that contains a comma", () => {
    const row = lines.find((line) => line.startsWith("walnut-nesting-table,"))!;
    expect(row).toContain('"<p>Two compact surfaces in a rich, warm timber finish.</p>');
    expect(row).toContain(",continue,manual,219.00,TRUE,TRUE,");
    expect(row.endsWith(",active")).toBe(true);
  });

  it("doubles an embedded quote and leaves plain fields bare", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("plain")).toBe("plain");
  });

  it("matches the checked-in products.csv and products.json", () => {
    expect(readExample("products.csv")).toBe(`${csv}\n`);
    const json = JSON.parse(readExample("products.json")) as {
      imageBase: string;
      count: number;
      products: ShopProduct[];
    };
    expect(json.imageBase).toBe(DEFAULT_IMAGE_BASE);
    expect(json.count).toBe(43);
    expect(json.products).toEqual(CATALOG);
  });
});

describe("planProductSet", () => {
  const product = CATALOG[0]!;

  it("creates with a handle and no identifier", () => {
    const plan = planProductSet(product, null);
    expect(plan.query).toContain("mutation ProductSetCreate");
    expect(plan.query).not.toContain("$identifier");
    expect(plan.variables.identifier).toBeUndefined();
    const input = plan.variables.input as Record<string, unknown>;
    expect(input.handle).toBe(product.handle);
    expect(input.status).toBe("ACTIVE");
    expect(input.vendor).toBe("OpenRoom");
    expect(input.productOptions).toEqual([
      { name: "Title", position: 1, values: [{ name: "Default Title" }] },
    ]);
    expect(input.variants).toEqual([
      {
        optionValues: [{ optionName: "Title", name: "Default Title" }],
        price: product.priceUsd,
        sku: product.handle,
        inventoryPolicy: "CONTINUE",
      },
    ]);
    expect(input.files).toEqual([
      {
        originalSource: product.imageUrl,
        alt: product.title,
        filename: `${product.handle}.webp`,
        contentType: "IMAGE",
      },
    ]);
  });

  it("updates by product id", () => {
    const plan = planProductSet(product, "gid://shopify/Product/42");
    expect(plan.query).toContain("mutation ProductSetUpdate");
    expect(plan.variables.identifier).toEqual({ id: "gid://shopify/Product/42" });
    expect((plan.variables.input as Record<string, unknown>).handle).toBe(product.handle);
  });

  it("leaves existing media alone when asked, and sends the cutout otherwise", () => {
    const kept = planProductSet(product, "gid://shopify/Product/42", { keepMedia: true });
    expect((kept.variables.input as Record<string, unknown>).files).toBeUndefined();
    const fresh = planProductSet(product, "gid://shopify/Product/42");
    expect((fresh.variables.input as Record<string, unknown>).files).toHaveLength(1);
  });
});

describe("planCollections", () => {
  it("plans one smart collection per category, matching on product type", () => {
    const plans = planCollections(CATALOG);
    expect(plans.map((plan) => plan.handle)).toEqual([
      "sofa",
      "coffee-table",
      "rug",
      "floor-lamp",
      "chair",
      "plant",
      "side-table",
      "bookshelf",
    ]);
    const input = plans[1]!.variables.input as Record<string, unknown>;
    expect(input.title).toBe("Coffee table");
    expect(input.ruleSet).toEqual({
      appliedDisjunctively: false,
      rules: [{ column: "TYPE", relation: "EQUALS", condition: "Coffee table" }],
    });
  });

  it("slugifies a label into a handle", () => {
    expect(collectionHandle("Floor lamp")).toBe("floor-lamp");
  });
});

describe("seedStore", () => {
  it("upserts every product, publishes it, and creates only the missing collections", async () => {
    const catalog = fixtureCatalog();
    const { client, calls } = createFakeClient({
      existingProducts: ["boucle-curve-sofa"],
      existingCollections: ["sofa"],
    });
    const logs: string[] = [];

    const result = await seedStore(client, catalog, { log: (line) => logs.push(line) });

    expect(result.publicationId).toBe("gid://shopify/Publication/1");
    expect(result.products).toEqual([
      {
        handle: "hinoki-low-sofa",
        productId: "gid://shopify/Product/hinoki-low-sofa",
        variantId: "gid://shopify/ProductVariant/hinoki-low-sofa",
        created: true,
      },
      {
        handle: "boucle-curve-sofa",
        productId: "gid://shopify/Product/boucle-curve-sofa",
        variantId: "gid://shopify/ProductVariant/boucle-curve-sofa",
        created: false,
      },
      {
        handle: "oak-frame-table",
        productId: "gid://shopify/Product/oak-frame-table",
        variantId: "gid://shopify/ProductVariant/oak-frame-table",
        created: true,
      },
    ]);
    expect(result.collections).toEqual([
      { handle: "sofa", collectionId: "gid://shopify/Collection/sofa", created: false },
      {
        handle: "coffee-table",
        collectionId: "gid://shopify/Collection/coffee-table",
        created: true,
      },
    ]);

    const creates = calls.filter((call) => call.document.includes("mutation ProductSetCreate"));
    const updates = calls.filter((call) => call.document.includes("mutation ProductSetUpdate"));
    expect(creates).toHaveLength(2);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.variables.identifier).toEqual({
      id: "gid://shopify/Product/boucle-curve-sofa",
    });
    // The existing product already has media, so the update re-sends no file.
    expect((updates[0]!.variables.input as Record<string, unknown>).files).toBeUndefined();
    expect((creates[0]!.variables.input as Record<string, unknown>).files).toHaveLength(1);

    const collectionCreates = calls.filter((call) =>
      call.document.includes("mutation CollectionCreate"),
    );
    expect(collectionCreates).toHaveLength(1);
    expect((collectionCreates[0]!.variables.input as { handle: string }).handle).toBe(
      "coffee-table",
    );

    const publishes = calls.filter((call) =>
      call.document.includes("mutation PublishablePublish"),
    );
    expect(publishes).toHaveLength(5);
    expect(publishes[0]!.variables.input).toEqual([
      { publicationId: "gid://shopify/Publication/1" },
    ]);

    expect(logs).toContain(
      "[seed] hinoki-low-sofa created → gid://shopify/ProductVariant/hinoki-low-sofa",
    );
    expect(logs).toContain(
      "[seed] boucle-curve-sofa updated → gid://shopify/ProductVariant/boucle-curve-sofa",
    );
    expect(logs).toContain("[seed] collection coffee-table created");
  });

  it("stops when the store has no Online Store publication", async () => {
    const client: AdminClient = {
      endpoint: "https://fake-store.myshopify.com/admin/api/2026-01/graphql.json",
      async query<T>(): Promise<T> {
        return { publications: { nodes: [] } } as unknown as T;
      },
    };
    await expect(seedStore(client, fixtureCatalog())).rejects.toThrow(/Online Store/);
  });

  it("reports a userError instead of carrying on", async () => {
    const client: AdminClient = {
      endpoint: "https://fake-store.myshopify.com/admin/api/2026-01/graphql.json",
      async query<T>(document: string): Promise<T> {
        if (document.includes("query Publications")) {
          return {
            publications: { nodes: [{ id: "gid://shopify/Publication/1", name: "Online Store" }] },
          } as unknown as T;
        }
        if (document.includes("query ProductByHandle")) {
          return { products: { nodes: [] } } as unknown as T;
        }
        return {
          productSet: {
            product: null,
            userErrors: [{ field: ["input", "handle"], message: "Handle is taken" }],
          },
        } as unknown as T;
      },
    };
    await expect(seedStore(client, fixtureCatalog())).rejects.toThrow(/Handle is taken/);
  });

  it("only logs in dry-run mode", async () => {
    const catalog = fixtureCatalog();
    const logs: string[] = [];
    const client: AdminClient = {
      endpoint: "https://fake-store.myshopify.com/admin/api/2026-01/graphql.json",
      async query<T>(): Promise<T> {
        throw new Error("dry run must not send a request");
      },
    };

    const result = await seedStore(client, catalog, {
      dryRun: true,
      log: (line) => logs.push(line),
    });

    expect(result.publicationId).toBeNull();
    expect(result.products.map((product) => product.handle)).toEqual([
      "hinoki-low-sofa",
      "boucle-curve-sofa",
      "oak-frame-table",
    ]);
    expect(result.products.every((product) => product.variantId === null)).toBe(true);
    expect(result.collections.map((collection) => collection.handle)).toEqual([
      "sofa",
      "coffee-table",
    ]);
    expect(logs[0]).toContain("dry run");
    expect(logs.some((line) => line.includes("hinoki-low-sofa would be created or updated"))).toBe(
      true,
    );
    expect(logs.at(-1)).toBe("[seed] dry run complete: 3 products, 2 collections, 0 requests");
  });
});

describe("variants", () => {
  it("round-trips through the app's parseVariantOverrides", () => {
    const entries = [
      { handle: "oak-frame-table", variantId: "gid://shopify/ProductVariant/2" },
      { handle: "ash-lounge-chair", variantId: "gid://shopify/ProductVariant/1" },
      { handle: "woven-jute-rug", variantId: null },
    ];
    const line = buildVariantsEnvLine(entries);

    expect(line).toBe(
      "NEXT_PUBLIC_SHOPIFY_VARIANTS=ash-lounge-chair=gid://shopify/ProductVariant/1," +
        "oak-frame-table=gid://shopify/ProductVariant/2",
    );
    expect(parseVariantOverrides(line.slice("NEXT_PUBLIC_SHOPIFY_VARIANTS=".length))).toEqual({
      "ash-lounge-chair": "gid://shopify/ProductVariant/1",
      "oak-frame-table": "gid://shopify/ProductVariant/2",
    });
  });

  it("reads the default variant of each handle, one request at a time", async () => {
    const { client, calls } = createFakeClient({ existingProducts: ["oak-frame-table"] });
    const entries = await fetchStoreVariants(client, ["oak-frame-table", "missing-product"]);

    expect(entries).toEqual([
      { handle: "oak-frame-table", variantId: "gid://shopify/ProductVariant/oak-frame-table" },
      { handle: "missing-product", variantId: null },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.variables.q).toBe("handle:oak-frame-table");
  });

  it("replaces only its own key in an .env.local body", () => {
    const body = [
      "NEXT_PUBLIC_COMMERCE_PROVIDER=shopify",
      "NEXT_PUBLIC_SHOPIFY_VARIANTS=stale=gid://shopify/ProductVariant/0",
      "SHOPIFY_ADMIN_ACCESS_TOKEN=keep-me",
      "",
    ].join("\n");
    const line = "NEXT_PUBLIC_SHOPIFY_VARIANTS=a=gid://shopify/ProductVariant/1";

    expect(upsertEnvLine(body, line)).toBe(
      [
        "NEXT_PUBLIC_COMMERCE_PROVIDER=shopify",
        line,
        "SHOPIFY_ADMIN_ACCESS_TOKEN=keep-me",
        "",
      ].join("\n"),
    );
    expect(upsertEnvLine("", line)).toBe(`${line}\n`);
  });
});

describe("createAdminClient", () => {
  const OK_BODY = JSON.stringify({ data: { shop: { name: "Test" } } });

  it("builds the versioned admin endpoint", () => {
    expect(adminEndpoint("your-store.myshopify.com", "2026-01")).toBe(
      "https://your-store.myshopify.com/admin/api/2026-01/graphql.json",
    );
    expect(adminEndpoint("https://your-store.myshopify.com/", "2026-01")).toBe(
      "https://your-store.myshopify.com/admin/api/2026-01/graphql.json",
    );
  });

  it("retries once on 429 and then succeeds", async () => {
    const responses = [
      new Response("", { status: 429, headers: { "Retry-After": "3" } }),
      new Response(OK_BODY, { status: 200 }),
    ];
    const sent: RequestInit[] = [];
    const slept: number[] = [];
    const client = createAdminClient({
      storeDomain: "your-store.myshopify.com",
      accessToken: "shpat_placeholder",
      fetch: (async (_url: string, init: RequestInit) => {
        sent.push(init);
        return responses.shift()!;
      }) as unknown as typeof globalThis.fetch,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    const data = await client.query<{ shop: { name: string } }>("query { shop { name } }");

    expect(data.shop.name).toBe("Test");
    expect(sent).toHaveLength(2);
    expect(slept).toEqual([3000]);
    expect(
      (sent[0]!.headers as Record<string, string>)["X-Shopify-Access-Token"],
    ).toBe("shpat_placeholder");
  });

  it("retries a THROTTLED graphql error with the default delay", async () => {
    const responses = [
      new Response(JSON.stringify({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }), {
        status: 200,
      }),
      new Response(OK_BODY, { status: 200 }),
    ];
    const slept: number[] = [];
    const client = createAdminClient({
      storeDomain: "your-store.myshopify.com",
      accessToken: "shpat_placeholder",
      fetch: (async () => responses.shift()!) as unknown as typeof globalThis.fetch,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    await expect(client.query("query { shop { name } }")).resolves.toEqual({
      shop: { name: "Test" },
    });
    expect(slept).toEqual([2000]);
  });

  it("names the fix for a 403", async () => {
    const client = createAdminClient({
      storeDomain: "your-store.myshopify.com",
      accessToken: "shpat_placeholder",
      fetch: (async () => new Response("", { status: 403 })) as unknown as typeof globalThis.fetch,
    });
    await expect(client.query("query { shop { name } }")).rejects.toThrow(
      /check the app's scopes and token/,
    );
  });

  it("surfaces a graphql error message", async () => {
    const client = createAdminClient({
      storeDomain: "your-store.myshopify.com",
      accessToken: "shpat_placeholder",
      fetch: (async () =>
        new Response(JSON.stringify({ errors: [{ message: "Field 'nope' doesn't exist" }] }), {
          status: 200,
        })) as unknown as typeof globalThis.fetch,
    });
    await expect(client.query("query { nope }")).rejects.toThrow(/Field 'nope' doesn't exist/);
  });
});

describe("script environment", () => {
  it("parses a .env body without interpolation and reports missing keys by name", () => {
    const parsed = parseEnvFile(
      ["# comment", "export SHOPIFY_STORE_DOMAIN=demo.myshopify.com", 'SHOPIFY_API_VERSION="2026-01"', ""].join(
        "\n",
      ),
    );
    expect(parsed).toEqual({
      SHOPIFY_STORE_DOMAIN: "demo.myshopify.com",
      SHOPIFY_API_VERSION: "2026-01",
    });

    const required = requireEnv(parsed, ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"]);
    expect(required.missing).toEqual(["SHOPIFY_ADMIN_ACCESS_TOKEN"]);
    expect(required.values.SHOPIFY_STORE_DOMAIN).toBe("demo.myshopify.com");
  });

  it("keeps the shipped .env.example free of a real token", () => {
    const example = readExample(".env.example");
    expect(example).toContain("SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...");
    expect(example).toContain("SHOPIFY_API_VERSION=2026-01");
    expect(example).toContain(`OPENROOM_IMAGE_BASE=${DEFAULT_IMAGE_BASE}`);
    expect(/shpat_[A-Za-z0-9]{8,}/.test(example)).toBe(false);
  });
});
