import { COMMERCE_CONFIG } from "./commerce-config";
import type { CommerceContext } from "./commerce-types";
import { ACTIVE_SHOPIFY_VARIANTS } from "./shopify-variants";

/**
 * What the build alone knows. The running page may point somewhere else — see
 * `useCommerceContext` — but a server render has no storage to consult, so
 * this is always the first paint.
 */
export const BUILD_COMMERCE: CommerceContext = {
  config: COMMERCE_CONFIG,
  variants: ACTIVE_SHOPIFY_VARIANTS,
};
