import { describe, expect, test } from "vitest";

import {
  DEMO_PRODUCTS,
  PRODUCT_IDS_BY_CATEGORY,
} from "../../src/features/demo/demo-data";
import { CATEGORY_DIMENSIONS } from "../../src/features/room/room-engine";
import {
  ProductCategorySchema,
  type ProductCategory,
} from "../../src/features/scene/scene-schema";
import { CatalogProductSchema } from "../../src/webmcp/tool-context";

/** Design §5: every category carries at least this many products. */
const MINIMUM_PER_CATEGORY = 5;
/** Design §5: dimensions stay inside ±40% of the category envelope. */
const ENVELOPE_TOLERANCE = 0.4;
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The shop reads as three families; the first style tag names the family. */
const STYLE_FAMILIES = ["japandi", "modern-organic", "mid-century"] as const;

/**
 * Five products predate the envelope rule: their `dimensionsCm` describe
 * foliage spread or a wide shade rather than the placement footprint, and
 * design §2 freezes existing products, ids, and prices. The list is pinned
 * exactly so no new product can quietly join it, and so fixing one of these
 * (which needs its own approved change) fails here until the entry is dropped.
 */
const LEGACY_ENVELOPE_EXCEPTIONS = [
  "geometric-flatweave-rug",
  "linen-dome-lamp",
  "ceramic-olive-tree",
  "stone-planter-ficus",
  "teak-planter-palm",
  // Table-height stand lamps sit inside the floor_lamp category on purpose (spec
  // true-scale §5); their height is a third of the category envelope.
  "linen-drum-table-lamp",
  "ceramic-gourd-table-lamp",
  "brass-stem-table-lamp",
] as const;

const CATEGORIES = ProductCategorySchema.options;

function productsIn(category: ProductCategory) {
  return DEMO_PRODUCTS.filter((product) => product.category === category);
}

/** The category envelope in centimetres, matching `dimensionsCm`. */
function envelopeCm(category: ProductCategory) {
  const nominal = CATEGORY_DIMENSIONS[category];
  return {
    width: nominal.width * 100,
    height: nominal.height * 100,
    depth: nominal.depth * 100,
  };
}

function outsideEnvelope(product: (typeof DEMO_PRODUCTS)[number]): boolean {
  const envelope = envelopeCm(product.category);
  return (["width", "height", "depth"] as const).some((axis) => {
    const nominal = envelope[axis];
    const actual = product.dimensionsCm[axis];
    return (
      actual < nominal * (1 - ENVELOPE_TOLERANCE) ||
      actual > nominal * (1 + ENVELOPE_TOLERANCE)
    );
  });
}

describe("demo catalog", () => {
  test("carries at least five products for every product category", () => {
    for (const category of CATEGORIES) {
      expect(productsIn(category).length, category)
        .toBeGreaterThanOrEqual(MINIMUM_PER_CATEGORY);
    }
    expect(CATEGORIES).toHaveLength(8);
  });

  test("groups every product under its category in catalog order", () => {
    expect(Object.keys(PRODUCT_IDS_BY_CATEGORY)).toEqual([...CATEGORIES]);
    for (const category of CATEGORIES) {
      expect(PRODUCT_IDS_BY_CATEGORY[category], category)
        .toEqual(productsIn(category).map(({ id }) => id));
    }
    expect(
      Object.values(PRODUCT_IDS_BY_CATEGORY).flat(),
    ).toHaveLength(DEMO_PRODUCTS.length);
  });

  test("parses every product as a catalog product", () => {
    for (const product of DEMO_PRODUCTS) {
      const parsed = CatalogProductSchema.safeParse(product);
      expect(parsed.success, `${product.id}: ${parsed.error?.message ?? ""}`)
        .toBe(true);
    }
  });

  test("keeps ids unique, kebab-case, and mirrored by every variant id", () => {
    const ids = DEMO_PRODUCTS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);

    const variantIds = DEMO_PRODUCTS.map(({ variantId }) => variantId);
    expect(new Set(variantIds).size).toBe(variantIds.length);

    for (const product of DEMO_PRODUCTS) {
      expect(product.id, product.id).toMatch(KEBAB_CASE);
      expect(product.variantId, product.id).toBe(`demo-variant-${product.id}`);
    }
  });

  test("writes copy a shopper can read: title, description, and two style tags", () => {
    for (const product of DEMO_PRODUCTS) {
      expect(product.title.trim(), product.id).not.toBe("");
      expect(product.description.trim(), product.id).not.toBe("");
      expect(product.description.length, product.id)
        .toBeLessThanOrEqual(500);
      expect(product.styleTags.length, product.id).toBeGreaterThanOrEqual(2);
      expect(new Set(product.styleTags).size, product.id)
        .toBe(product.styleTags.length);
      expect(STYLE_FAMILIES, product.id).toContain(product.styleTags[0]);
      expect(product.color, product.id).not.toBeNull();
      expect(product.material, product.id).not.toBeNull();
    }
  });

  test("prices every product in whole USD minor units", () => {
    for (const product of DEMO_PRODUCTS) {
      expect(product.price.currency, product.id).toBe("USD");
      expect(Number.isInteger(product.price.amountMinor), product.id).toBe(true);
      expect(product.price.amountMinor, product.id).toBeGreaterThan(0);
    }
  });

  test("keeps dimensions inside the category envelope, legacy products aside", () => {
    expect(DEMO_PRODUCTS.filter(outsideEnvelope).map(({ id }) => id))
      .toEqual([...LEGACY_ENVELOPE_EXCEPTIONS]);
  });
});
