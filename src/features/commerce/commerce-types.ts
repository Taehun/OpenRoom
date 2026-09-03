export type CommerceConfig =
  | {
      provider: "demo";
      reason: "default" | "not-configured" | "invalid-domain";
    }
  | { provider: "shopify"; storeDomain: string; mcpEndpoint: string };

export interface CommerceEnv {
  NEXT_PUBLIC_COMMERCE_PROVIDER?: string | undefined;
  NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN?: string | undefined;
}

export type ShopifyVariantMap = Readonly<Record<string, string | null>>;

export interface CartLineInput {
  productId: string;
  quantity: number;
}

export interface CommerceLine {
  productId: string;
  merchandiseId: string;
  quantity: number;
}

export interface SkippedLine {
  productId: string;
  reason: "unmapped" | "invalid";
}

export interface CommerceDraft {
  provider: "shopify";
  storeDomain: string;
  mcpEndpoint: string;
  lines: readonly CommerceLine[];
  skipped: readonly SkippedLine[];
  checkoutPermalink: string | null;
}

export interface CommerceContext {
  config: CommerceConfig;
  variants: ShopifyVariantMap;
}
