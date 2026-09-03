import type { ShopifyVariantMap } from "./commerce-types";

export const SHOPIFY_VARIANT_GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/;

// Fill these with your store's variant GIDs, or set NEXT_PUBLIC_SHOPIFY_VARIANTS.
// Keys are the demo catalog product ids (src/features/demo/demo-data.ts) — the
// only things a cart can hold. Never commit a real store's GIDs here.
export const SHOPIFY_VARIANTS: ShopifyVariantMap = {
  "hinoki-low-sofa": null,
  "boucle-curve-sofa": null,
  "walnut-frame-sofa": null,
  "oat-linen-slipcover-sofa": null,
  "cane-back-teak-sofa": null,
  "oak-frame-table": null,
  "travertine-plinth-table": null,
  "walnut-nesting-table": null,
  "ash-plinth-table": null,
  "teak-oval-table": null,
  "woven-jute-rug": null,
  "wool-pebble-rug": null,
  "geometric-flatweave-rug": null,
  "undyed-wool-shag-rug": null,
  "charcoal-border-rug": null,
  "rice-paper-floor-lamp": null,
  "linen-dome-lamp": null,
  "brass-globe-lamp": null,
  "oak-tripod-lamp": null,
  "ceramic-column-lamp": null,
  "linen-drum-table-lamp": null,
  "ceramic-gourd-table-lamp": null,
  "brass-stem-table-lamp": null,
  "ash-lounge-chair": null,
  "boucle-barrel-chair": null,
  "cognac-sling-chair": null,
  "oak-paper-cord-chair": null,
  "shearling-swivel-chair": null,
  "ceramic-olive-tree": null,
  "stone-planter-ficus": null,
  "teak-planter-palm": null,
  "stoneware-snake-plant": null,
  "rattan-basket-fern": null,
  "oak-drum-side-table": null,
  "travertine-cube-side-table": null,
  "black-steel-tray-table": null,
  "walnut-pedestal-side-table": null,
  "rattan-nesting-side-table": null,
  "oak-ladder-shelf": null,
  "walnut-low-shelf": null,
  "white-oak-cube-storage": null,
  "steel-and-ash-etagere": null,
  "hinoki-open-bookcase": null,
};

export interface VariantIssue {
  productId: string;
  issue: "invalid-gid" | "duplicate-gid";
}

export interface ValidatedVariants {
  variants: Readonly<Record<string, string>>;
  issues: readonly VariantIssue[];
}

export function validateShopifyVariants(map: ShopifyVariantMap): ValidatedVariants {
  const variants: Record<string, string> = {};
  const issues: VariantIssue[] = [];
  const owners = new Set<string>();
  for (const [productId, gid] of Object.entries(map)) {
    if (gid === null) continue;
    if (!SHOPIFY_VARIANT_GID_PATTERN.test(gid)) {
      issues.push({ productId, issue: "invalid-gid" });
      continue;
    }
    if (owners.has(gid)) {
      issues.push({ productId, issue: "duplicate-gid" });
      continue;
    }
    owners.add(gid);
    variants[productId] = gid;
  }
  return { variants, issues };
}

const BARE_VARIANT_ID_PATTERN = /^\d+$/;

/**
 * Shopify admin shows a variant's numeric id in the URL, so both spellings are
 * accepted here and normalised to the GID form the validator expects. Anything
 * else is passed through untouched and rejected later as `invalid-gid`.
 */
export function normalizeVariantId(value: string): string {
  return BARE_VARIANT_ID_PATTERN.test(value)
    ? `gid://shopify/ProductVariant/${value}`
    : value;
}

export function parseVariantOverrides(value: string | undefined): ShopifyVariantMap {
  if (value === undefined) return {};
  const entries: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const productId = pair.slice(0, separator).trim();
    const gid = pair.slice(separator + 1).trim();
    if (productId === "" || gid === "") continue;
    entries[productId] = normalizeVariantId(gid);
  }
  return entries;
}

export function loadShopifyVariants(
  env: { NEXT_PUBLIC_SHOPIFY_VARIANTS?: string | undefined },
  base: ShopifyVariantMap = SHOPIFY_VARIANTS,
): ShopifyVariantMap {
  return { ...base, ...parseVariantOverrides(env.NEXT_PUBLIC_SHOPIFY_VARIANTS) };
}

export function variantNumericId(gid: string): string | null {
  return SHOPIFY_VARIANT_GID_PATTERN.exec(gid)?.[1] ?? null;
}

export const ACTIVE_SHOPIFY_VARIANTS: ShopifyVariantMap = loadShopifyVariants({
  NEXT_PUBLIC_SHOPIFY_VARIANTS: process.env.NEXT_PUBLIC_SHOPIFY_VARIANTS,
});
