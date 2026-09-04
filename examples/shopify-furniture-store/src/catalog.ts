/**
 * The OpenRoom demo catalog, reshaped into the fields a Shopify product needs.
 *
 * Everything here is pure: no `fetch`, no file system, no environment. The
 * catalog and its cutouts are read from the app (`DEMO_PRODUCTS`,
 * `PHOTO_ASSETS`) so the store can never drift from what OpenRoom shows, and
 * the same shape feeds both the Admin API seeder and the CSV import file.
 */
import type { DemoProduct } from "../../../src/features/demo/demo-types";
import { OBJECT_LABELS, humanizeSlug } from "../../../src/features/demo/object-labels";
import type { PhotoAsset } from "../../../src/features/photo/photo-assets";

/** Where the deployed cutouts live when nothing overrides `OPENROOM_IMAGE_BASE`. */
export const DEFAULT_IMAGE_BASE = "https://openroom-y20.pages.dev";

export const SHOP_VENDOR = "OpenRoom";

export interface ShopProduct {
  /** The OpenRoom product id. It is also the Shopify handle and the SKU. */
  handle: string;
  title: string;
  /** The category label — Shopify's "Type", and what the smart collections match. */
  productType: string;
  descriptionHtml: string;
  vendor: typeof SHOP_VENDOR;
  tags: string[];
  /** Decimal string, e.g. `"1899.00"`. */
  priceUsd: string;
  sku: string;
  imageUrl: string;
  imageAlt: string;
  dimensionsCm: { width: number; height: number; depth: number };
}

/** `189900` cents becomes `"1899.00"`; Shopify wants a decimal string. */
export function priceFromMinor(amountMinor: number): string {
  const whole = Math.trunc(amountMinor / 100);
  const cents = Math.abs(amountMinor % 100);
  return `${whole}.${String(cents).padStart(2, "0")}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** `https://base/` + `/demo/photo/products/x.webp` with exactly one slash. */
export function joinImageUrl(imageBase: string, src: string): string {
  return `${imageBase.replace(/\/+$/, "")}/${src.replace(/^\/+/, "")}`;
}

/** Category label, material, colour, then style tags — humanised, deduplicated. */
export function buildTags(product: DemoProduct): string[] {
  const candidates = [
    OBJECT_LABELS[product.category],
    product.material === null ? null : humanizeSlug(product.material),
    product.color === null ? null : humanizeSlug(product.color),
    ...product.styleTags.map(humanizeSlug),
  ];
  const tags: string[] = [];
  for (const tag of candidates) {
    if (tag === null || tag === "") continue;
    if (tags.includes(tag)) continue;
    tags.push(tag);
  }
  return tags;
}

function descriptionHtmlFor(product: DemoProduct): string {
  const { width, depth, height } = product.dimensionsCm;
  const size = `W ${width} × D ${depth} × H ${height} cm`;
  return `<p>${escapeHtml(product.description)}</p><p>${size}</p>`;
}

/**
 * One `ShopProduct` per catalog entry, in catalog order. A product without a
 * registered cutout is an error rather than a product with no image: the store
 * is meant to mirror what the app renders.
 */
export function buildShopCatalog(
  products: readonly DemoProduct[],
  assets: Readonly<Record<string, PhotoAsset>>,
  imageBase: string = DEFAULT_IMAGE_BASE,
): ShopProduct[] {
  return products.map((product) => {
    const asset = assets[product.id];
    if (!asset) {
      throw new Error(`no cutout registered for ${product.id}; run pnpm assets:products`);
    }
    return {
      handle: product.id,
      title: product.title,
      productType: OBJECT_LABELS[product.category],
      descriptionHtml: descriptionHtmlFor(product),
      vendor: SHOP_VENDOR,
      tags: buildTags(product),
      priceUsd: priceFromMinor(product.price.amountMinor),
      sku: product.id,
      imageUrl: joinImageUrl(imageBase, asset.src),
      imageAlt: product.title,
      dimensionsCm: { ...product.dimensionsCm },
    };
  });
}

/** The Shopify "Products → Import" column order this kit writes. */
export const CSV_COLUMNS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Variant SKU",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Variant Price",
  "Variant Requires Shipping",
  "Variant Taxable",
  "Image Src",
  "Image Alt Text",
  "Status",
] as const;

/** RFC 4180: quote a field that holds a quote, comma, or line break. */
export function csvField(value: string): string {
  return /["\n\r,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The import file for stores where running the seeder is not an option.
 * Header plus one row per product, `\n` separated and with no trailing
 * newline — `scripts/export-catalog.ts` adds the final one when it writes.
 */
export function toShopifyCsv(catalog: readonly ShopProduct[]): string {
  const rows = catalog.map((product) =>
    [
      product.handle,
      product.title,
      product.descriptionHtml,
      product.vendor,
      product.productType,
      product.tags.join(", "),
      "TRUE",
      "Title",
      "Default Title",
      product.sku,
      "continue",
      "manual",
      product.priceUsd,
      "TRUE",
      "TRUE",
      product.imageUrl,
      product.imageAlt,
      "active",
    ]
      .map(csvField)
      .join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\n");
}
