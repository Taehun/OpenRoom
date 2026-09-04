import type {
  CartApprovalDraft,
  CartDraftBase,
} from "../../webmcp/tool-context";
import type {
  CartLineInput,
  CommerceContext,
  CommerceDraft,
  CommerceLine,
  ProductLink,
  ShopifyVariantMap,
  SkippedLine,
} from "./commerce-types";
import { validateShopifyVariants, variantNumericId } from "./shopify-variants";

export interface ResolvedLine extends CommerceLine {
  variantId: string;
}

export function resolveShopifyLines(
  items: readonly CartLineInput[],
  map: ShopifyVariantMap,
): { lines: ResolvedLine[]; skipped: SkippedLine[] } {
  const { variants, issues } = validateShopifyVariants(map);
  const invalidProductIds = new Set(issues.map(({ productId }) => productId));
  const lines: ResolvedLine[] = [];
  const linesByGid = new Map<string, ResolvedLine>();
  const skipped: SkippedLine[] = [];
  const skippedProductIds = new Set<string>();

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) continue;
    const gid = variants[item.productId];
    const variantId = gid === undefined ? null : variantNumericId(gid);
    if (gid === undefined || variantId === null) {
      if (!skippedProductIds.has(item.productId)) {
        skippedProductIds.add(item.productId);
        skipped.push({
          productId: item.productId,
          reason: invalidProductIds.has(item.productId) ? "invalid" : "unmapped",
        });
      }
      continue;
    }
    const existing = linesByGid.get(gid);
    if (existing) {
      existing.quantity += item.quantity;
      continue;
    }
    const line: ResolvedLine = {
      productId: item.productId,
      merchandiseId: gid,
      variantId,
      quantity: item.quantity,
    };
    linesByGid.set(gid, line);
    lines.push(line);
  }

  return { lines, skipped };
}

export function buildCartPermalink(
  storeDomain: string,
  lines: readonly ResolvedLine[],
): string | null {
  if (lines.length === 0) return null;
  const path = lines.map(({ variantId, quantity }) => `${variantId}:${quantity}`).join(",");
  return `https://${storeDomain}/cart/${path}`;
}

export function buildProductLinks(
  storeDomain: string,
  items: readonly CartLineInput[],
): ProductLink[] {
  const seen = new Set<string>();
  const links: ProductLink[] = [];
  for (const { productId, quantity } of items) {
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);
    links.push({ productId, url: `https://${storeDomain}/products/${productId}` });
  }
  return links;
}

export function buildCommerceDraft(
  commerce: CommerceContext,
  items: readonly CartLineInput[],
): CommerceDraft | null {
  if (commerce.config.status !== "connected") return null;
  const { lines, skipped } = resolveShopifyLines(items, commerce.variants);
  return {
    provider: "shopify",
    storeDomain: commerce.config.storeDomain,
    mcpEndpoint: commerce.config.mcpEndpoint,
    agentProfileUrl: commerce.config.agentProfileUrl,
    lines: lines.map(({ productId, merchandiseId, quantity }) => ({
      productId,
      merchandiseId,
      quantity,
    })),
    skipped,
    checkoutPermalink: buildCartPermalink(commerce.config.storeDomain, lines),
    productLinks: buildProductLinks(commerce.config.storeDomain, items),
  };
}

export function enrichCartDraft(
  commerce: CommerceContext,
  draft: CartDraftBase,
): CartApprovalDraft {
  const block = buildCommerceDraft(
    commerce,
    draft.items.map(({ productId, quantity }) => ({ productId, quantity })),
  );
  // Tool handlers reject an unconfigured store before enriching. Keeping the
  // check here makes that trust boundary explicit for every future caller.
  if (block === null) {
    throw new Error("Cannot enrich a cart draft without a connected store");
  }
  return { ...draft, commerce: block };
}
