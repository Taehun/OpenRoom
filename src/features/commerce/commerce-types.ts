export type CommerceConfig =
  | {
      provider: "demo";
      reason: "default" | "not-configured" | "invalid-domain";
    }
  | {
      provider: "shopify";
      storeDomain: string;
      /**
       * The store's UCP MCP endpoint. Shopify's older `/api/mcp` cart tools
       * stopped being served on 31 August 2026; `/api/ucp/mcp` is where
       * get_cart, create_cart, update_cart, and the checkout tools live now.
       */
      mcpEndpoint: string;
      /**
       * Absolute URL of the UCP agent profile OpenRoom publishes, which every
       * `/api/ucp/mcp` call has to name. Null when no site origin is
       * configured, in which case the agent has to bring its own profile.
       */
      agentProfileUrl: string | null;
    };

export interface CommerceEnv {
  NEXT_PUBLIC_COMMERCE_PROVIDER?: string | undefined;
  NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN?: string | undefined;
  NEXT_PUBLIC_SITE_ORIGIN?: string | undefined;
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

export interface ProductLink {
  productId: string;
  url: string;
}

export interface CommerceDraft {
  provider: "shopify";
  storeDomain: string;
  mcpEndpoint: string;
  agentProfileUrl: string | null;
  lines: readonly CommerceLine[];
  skipped: readonly SkippedLine[];
  checkoutPermalink: string | null;
  /**
   * One link per requested product, mapped or not. The seed kit writes the
   * OpenRoom product id as the Shopify handle, so these stay correct on any
   * store seeded with it — which is what makes switching stores useful rather
   * than decorative.
   */
  productLinks: readonly ProductLink[];
}

export interface CommerceContext {
  config: CommerceConfig;
  variants: ShopifyVariantMap;
}
