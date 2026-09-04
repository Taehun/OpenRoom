import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommerceContext } from "../../src/features/commerce/commerce-types";
import {
  CartApprovalSheet,
  openInNewTab,
} from "../../src/features/demo/cart-approval-sheet";
import type { CartReviewDraft } from "../../src/webmcp/tool-context";
import {
  FIXTURE_AGENT_PROFILE_URL,
  FIXTURE_VARIANTS,
  FIXTURE_VARIANT_IDS,
  PLACEHOLDER_STORE_DOMAIN,
  SHOPIFY_COMMERCE,
  UNCONFIGURED_COMMERCE,
  fixtureGid,
  fixtureProductLinks,
} from "../helpers/commerce-fixtures";

const PERMALINK = `https://${PLACEHOLDER_STORE_DOMAIN}/cart/${FIXTURE_VARIANT_IDS["oak-frame-table"]}:1,${FIXTURE_VARIANT_IDS["woven-jute-rug"]}:1`;
const TABLE_PERMALINK = `https://${PLACEHOLDER_STORE_DOMAIN}/cart/${FIXTURE_VARIANT_IDS["oak-frame-table"]}:1`;

afterEach(() => {
  cleanup();
});

/** A room holding two catalog products, both mapped to Shopify variants. */
function mappedDraft(): CartReviewDraft {
  return {
    id: "scene-demo-rev-3",
    sceneId: "demo",
    sceneRevision: 3,
    items: [
      {
        objectId: "table_01",
        productId: "oak-frame-table",
        demoVariantId: "demo-variant-oak-frame-table",
        title: "Oak Frame Table",
        quantity: 1,
        price: { amountMinor: 16900, currency: "USD" },
      },
      {
        objectId: "rug_01",
        productId: "woven-jute-rug",
        demoVariantId: "demo-variant-woven-jute-rug",
        title: "Woven Jute Rug",
        quantity: 1,
        price: { amountMinor: 34900, currency: "USD" },
      },
    ],
    totalMinor: 51800,
    commerce: {
      provider: "shopify",
      storeDomain: PLACEHOLDER_STORE_DOMAIN,
      mcpEndpoint: `https://${PLACEHOLDER_STORE_DOMAIN}/api/ucp/mcp`,
      agentProfileUrl: FIXTURE_AGENT_PROFILE_URL,
      lines: [
        {
          productId: "oak-frame-table",
          merchandiseId: fixtureGid("oak-frame-table"),
          quantity: 1,
        },
        {
          productId: "woven-jute-rug",
          merchandiseId: fixtureGid("woven-jute-rug"),
          quantity: 1,
        },
      ],
      skipped: [],
      checkoutPermalink: PERMALINK,
      productLinks: fixtureProductLinks("oak-frame-table", "woven-jute-rug"),
    },
  };
}

/** A room with nothing product-backed in it — the seed room's cart. */
function emptyDraft(commerceBlock = false): CartReviewDraft {
  return {
    id: "scene-demo-rev-1",
    sceneId: "demo",
    sceneRevision: 1,
    items: [],
    totalMinor: 0,
    ...(commerceBlock
      ? {
          commerce: {
            provider: "shopify" as const,
            storeDomain: PLACEHOLDER_STORE_DOMAIN,
            mcpEndpoint: `https://${PLACEHOLDER_STORE_DOMAIN}/api/ucp/mcp`,
            agentProfileUrl: FIXTURE_AGENT_PROFILE_URL,
            lines: [],
            skipped: [],
            checkoutPermalink: null,
            productLinks: [],
          },
        }
      : {}),
  };
}

function agentDraft(): CartReviewDraft {
  return {
    id: "scene-demo-rev-4",
    sceneId: "demo",
    sceneRevision: 4,
    items: [
      {
        objectId: "table_01",
        productId: "oak-frame-table",
        demoVariantId: "demo-variant-oak-frame-table",
        title: "Oak Frame Table",
        quantity: 1,
        price: { amountMinor: 16900, currency: "USD" },
      },
      {
        objectId: "lamp_01",
        productId: "rice-paper-floor-lamp",
        demoVariantId: "demo-variant-rice-paper-floor-lamp",
        title: "Rice Paper Floor Lamp",
        quantity: 1,
        price: { amountMinor: 14900, currency: "USD" },
      },
    ],
    totalMinor: 31800,
    commerce: {
      provider: "shopify",
      storeDomain: PLACEHOLDER_STORE_DOMAIN,
      mcpEndpoint: `https://${PLACEHOLDER_STORE_DOMAIN}/api/ucp/mcp`,
      agentProfileUrl: FIXTURE_AGENT_PROFILE_URL,
      lines: [
        {
          productId: "oak-frame-table",
          merchandiseId: fixtureGid("oak-frame-table"),
          quantity: 1,
        },
      ],
      skipped: [{ productId: "rice-paper-floor-lamp", reason: "unmapped" }],
      checkoutPermalink: TABLE_PERMALINK,
      productLinks: fixtureProductLinks("oak-frame-table", "rice-paper-floor-lamp"),
    },
  };
}

describe("CartApprovalSheet while unconfigured", () => {
  it("lists the room's products and offers to connect a store", () => {
    const dispatch = vi.fn();
    render(
      <CartApprovalSheet
        commerce={UNCONFIGURED_COMMERCE}
        dispatch={dispatch}
        draft={mappedDraft()}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Oak Frame Table")).toBeVisible();
    expect(screen.getByText("Woven Jute Rug")).toBeVisible();
    expect(screen.getAllByText("Qty 1")).toHaveLength(2);
    expect(screen.queryByText(/Demo fixture|Scene product/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "open-store-settings" });
    expect(screen.queryByRole("button", { name: /Approve demo cart/ })).toBeNull();
    expect(screen.queryByText("Not mapped to a Shopify variant")).toBeNull();
  });

  it("says the room is empty and offers only Keep editing", () => {
    const dispatch = vi.fn();
    render(
      <CartApprovalSheet
        commerce={UNCONFIGURED_COMMERCE}
        dispatch={dispatch}
        draft={emptyDraft()}
      />,
    );
    expect(
      screen.getByText(
        "Nothing to order yet. Swap a piece with Find alternatives, or ask your AI app.",
      ),
    ).toBeVisible();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    // Nothing to approve, so the sheet offers no approval at all — and no $0
    // total or checkout disclosure to explain away.
    expect(screen.queryByRole("button", { name: "Connect a store" })).toBeNull();
    expect(screen.queryByText("Catalog estimate")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "close-cart" });
  });
});

describe("CartApprovalSheet in shopify mode", () => {
  it("opens the room's permalink in a new tab and announces it", () => {
    const dispatch = vi.fn();
    const openWindow = vi.fn(() => ({ opener: {} }) as unknown as Window);
    render(
      <CartApprovalSheet
        commerce={SHOPIFY_COMMERCE}
        dispatch={dispatch}
        draft={mappedDraft()}
        openWindow={openWindow}
      />,
    );
    expect(
      screen.getByText(PLACEHOLDER_STORE_DOMAIN, { exact: false }),
    ).toBeVisible();
    expect(screen.queryByText("Not mapped to a Shopify variant")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Shopify · $518" }),
    );
    expect(openWindow).toHaveBeenCalledWith(PERMALINK);
    expect(dispatch).toHaveBeenCalledWith({
      type: "open-external-checkout",
      itemCount: 2,
    });
  });

  it("shows a fallback link when the popup is blocked", () => {
    const dispatch = vi.fn();
    const openWindow = vi.fn(() => null);
    render(
      <CartApprovalSheet
        commerce={SHOPIFY_COMMERCE}
        dispatch={dispatch}
        draft={mappedDraft()}
        openWindow={openWindow}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Shopify · $518" }),
    );
    const link = screen.getByRole("link", { name: /^Open Shopify checkout/ });
    expect(link).toHaveAttribute("href", PERMALINK);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "open-external-checkout" }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("uses the agent draft's commerce block and skips unmapped items", () => {
    const dispatch = vi.fn();
    const openWindow = vi.fn(() => ({ opener: {} }) as unknown as Window);
    render(
      <CartApprovalSheet
        commerce={SHOPIFY_COMMERCE}
        dispatch={dispatch}
        draft={agentDraft()}
        openWindow={openWindow}
      />,
    );
    expect(
      screen.getByText("Rice Paper Floor Lamp").closest("li"),
    ).toHaveTextContent("Not mapped to a Shopify variant");
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Shopify · $169" }),
    );
    expect(openWindow).toHaveBeenCalledWith(TABLE_PERMALINK);
    expect(dispatch).toHaveBeenCalledWith({
      type: "open-external-checkout",
      itemCount: 1,
    });
  });

  it("calls the total a catalog estimate and defers pricing to Shopify", () => {
    render(
      <CartApprovalSheet
        commerce={SHOPIFY_COMMERCE}
        dispatch={vi.fn()}
        draft={mappedDraft()}
      />,
    );
    expect(screen.getByText("Catalog estimate")).toBeVisible();
    expect(
      screen.getByText("Shopify shows the store's prices at checkout."),
    ).toBeVisible();
    expect(screen.queryByText("Room total")).toBeNull();
  });

  it("announces checkout even when the popup's opener setter throws", () => {
    const dispatch = vi.fn();
    // WebKit exposes no cross-origin `opener` setter: assigning to it throws,
    // which used to abort the click handler before the announcement.
    const hostile = Object.defineProperty({} as Window, "opener", {
      configurable: true,
      get: () => null,
      set: () => {
        throw new TypeError("Cannot set property opener");
      },
    });
    const open = vi.spyOn(window, "open").mockReturnValue(hostile);
    try {
      render(
        <CartApprovalSheet
          commerce={SHOPIFY_COMMERCE}
          dispatch={dispatch}
          draft={mappedDraft()}
          openWindow={openInNewTab}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Continue to Shopify · $518" }),
      );
      expect(open).toHaveBeenCalledWith(PERMALINK, "_blank");
      expect(dispatch).toHaveBeenCalledWith({
        type: "open-external-checkout",
        itemCount: 2,
      });
      expect(
        screen.queryByRole("link", { name: /^Open Shopify checkout/ }),
      ).toBeNull();
    } finally {
      open.mockRestore();
    }
  });

  it("says the room is empty rather than blaming the variant map", () => {
    render(
      <CartApprovalSheet
        commerce={SHOPIFY_COMMERCE}
        dispatch={vi.fn()}
        draft={emptyDraft(true)}
      />,
    );
    expect(
      screen.getByText(
        "Nothing to order yet. Swap a piece with Find alternatives, or ask your AI app.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Continue to Shopify/ }),
    ).toBeNull();
    expect(
      screen.queryByText(
        "No item in this cart is mapped to a Shopify variant yet.",
      ),
    ).toBeNull();
  });

  it("offers product links inline when no permalink is available", () => {
    const base = agentDraft();
    const commerceBlock = base.commerce;
    if (!commerceBlock) throw new Error("Expected a commerce block");
    const draft: CartReviewDraft = {
      ...base,
      commerce: {
        ...commerceBlock,
        lines: [],
        checkoutPermalink: null,
        skipped: [
          { productId: "oak-frame-table", reason: "unmapped" },
          { productId: "rice-paper-floor-lamp", reason: "unmapped" },
        ],
      },
    };
    render(
      <CartApprovalSheet
        commerce={SHOPIFY_COMMERCE}
        dispatch={vi.fn()}
        draft={draft}
      />,
    );
    const button = screen.getByRole("button", {
      name: `Open 2 products on ${PLACEHOLDER_STORE_DOMAIN}`,
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    const links = screen.getAllByRole("link", {
      name: /Oak Frame Table|Rice Paper Floor Lamp/,
    });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      "href",
      `https://${PLACEHOLDER_STORE_DOMAIN}/products/oak-frame-table`,
    );
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noreferrer");
    expect(
      screen.getByText(
        "No item in this cart is mapped to a Shopify variant yet.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Catalog estimate").parentElement?.parentElement,
    ).toHaveTextContent("$318 USD");
  });
});

describe("CartApprovalSheet configuration reasons", () => {
  function unconfiguredCommerce(
    reason: "not-configured" | "invalid-domain",
  ): CommerceContext {
    return { config: { status: "unconfigured", reason }, variants: FIXTURE_VARIANTS };
  }

  it("explains that no store is connected", () => {
    render(
      <CartApprovalSheet
        commerce={unconfiguredCommerce("not-configured")}
        dispatch={vi.fn()}
        draft={mappedDraft()}
      />,
    );
    expect(
      screen.getByText(
        "No Shopify store is connected yet.",
      ),
    ).toBeVisible();
  });

  it("explains an invalid store domain", () => {
    render(
      <CartApprovalSheet
        commerce={unconfiguredCommerce("invalid-domain")}
        dispatch={vi.fn()}
        draft={mappedDraft()}
      />,
    );
    expect(
      screen.getByText(
        "The configured store address is not a bare host such as your-store.myshopify.com.",
      ),
    ).toBeVisible();
  });
});
