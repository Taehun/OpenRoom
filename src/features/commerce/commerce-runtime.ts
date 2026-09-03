import { COMMERCE_CONFIG } from "./commerce-config";
import type { CommerceContext } from "./commerce-types";
import { ACTIVE_SHOPIFY_VARIANTS } from "./shopify-variants";

export const ACTIVE_COMMERCE: CommerceContext = {
  config: COMMERCE_CONFIG,
  variants: ACTIVE_SHOPIFY_VARIANTS,
};
