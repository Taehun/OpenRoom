import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommerceContext } from "../../src/features/commerce/commerce-types";
import {
  CartApprovalSheet,
  openInNewTab,
} from "../../src/features/demo/cart-approval-sheet";
import type { CartApprovalDraft } from "../../src/webmcp/tool-context";
import {
  DEMO_COMMERCE,
  FIXTURE_AGENT_PROFILE_URL,
  FIXTURE_VARIANTS,
  FIXTURE_VARIANT_IDS,
  PLACEHOLDER_STORE_DOMAIN,
  SHOPIFY_COMMERCE,
  fixtureGid,
} from "../helpers/commerce-fixtures";

const PERMALINK = `https://${PLACEHOLDER_STORE_DOMAIN}/cart/${FIXTURE_VARIANT_IDS["oak-frame-table"]}:1,${FIXTURE_VARIANT_IDS["woven-jute-rug"]}:1`;
const TABLE_PERMALINK = `https://${PLACEHOLDER_STORE_DOMAIN}/cart/${FIXTURE_VARIANT_IDS["oak-frame-table"]}:1`;

afterEach(() => {
  cleanup();
});

/** A room holding two catalog products, both mapped to Shopify variants. */
function mappedDraft(): CartApprovalDraft {
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
    },
  };
}

/** A room with nothing product-backed in it — the seed room's cart. */
function emptyDraft(commerceBlock = false): CartApprovalDraft {
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
          },
        }
      : {}),
  };
}

function agentDraft(): CartApprovalDraft {
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
    },
  };
}

describe("CartApprovalSheet in demo mode", () => {
  it("lists the room's products and approves them without leaving the page", () => {
    const dispatch = vi.fn();
    render(
      <CartApprovalSheet
        commerce={DEMO_COMMERCE}
        dispatch={dispatch}
        draft={mappedDraft()}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Oak Frame Table")).toBeVisible();
    expect(screen.getByText("Woven Jute Rug")).toBeVisible();
    expect(screen.getAllByText("Qty 1")).toHaveLength(2);
    expect(screen.queryByText(/Demo fixture|Scene product/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Approve demo cart · $518" }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "confirm-demo-cart" });
    expect(screen.queryByText("Not mapped to a Shopify variant")).toBeNull();
  });

  it("names the demo total the way the header does", () => {
    render(
      <CartApprovalSheet
        commerce={DEMO_COMMERCE}
        dispatch={vi.fn()}
        draft={mappedDraft()}
      />,
    );
    expect(screen.getByText("Room total")).toBeVisible();
    expect(screen.getByText("Taxes and delivery calculated later")).toBeVisible();
  });

  it("says the room is empty and offers only Keep editing", () => {
    const dispatch = vi.fn();
    render(
      <CartApprovalSheet
        commerce={DEMO_COMMERCE}
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
    expect(
      screen.queryByRole("button", { name: /Approve demo cart/ }),
    ).toBeNull();
    expect(screen.queryByText("Room total")).toBeNull();
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

  it("disables checkout when nothing is mapped", () => {
    const dispatch = vi.fn();
    const base = agentDraft();
    const commerceBlock = base.commerce;
    if (!commerceBlock) throw new Error("Expected a commerce block");
    const draft: CartApprovalDraft = {
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
        dispatch={dispatch}
        draft={draft}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Continue to Shopify · $0" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "No item in this cart is mapped to a Shopify variant yet.",
      ),
    ).toBeVisible();
  });
});

describe("CartApprovalSheet configuration reasons", () => {
  function demoCommerce(
    reason: "default" | "not-configured" | "invalid-domain",
  ): CommerceContext {
    return { config: { provider: "demo", reason }, variants: FIXTURE_VARIANTS };
  }

  it("explains an unconfigured Shopify provider", () => {
    render(
      <CartApprovalSheet
        commerce={demoCommerce("not-configured")}
        dispatch={vi.fn()}
        draft={mappedDraft()}
      />,
    );
    expect(
      screen.getByText(
        "Shopify checkout is not configured. Set NEXT_PUBLIC_COMMERCE_PROVIDER=shopify and NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN, then rebuild.",
      ),
    ).toBeVisible();
  });

  it("explains an invalid store domain", () => {
    render(
      <CartApprovalSheet
        commerce={demoCommerce("invalid-domain")}
        dispatch={vi.fn()}
        draft={mappedDraft()}
      />,
    );
    expect(
      screen.getByText(
        "Shopify checkout is disabled: NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN must be a bare host such as your-store.myshopify.com. Rebuild after fixing it.",
      ),
    ).toBeVisible();
  });

  it("stays silent and demo-only when commerce is simply off", () => {
    const dispatch = vi.fn();
    render(
      <CartApprovalSheet
        commerce={demoCommerce("default")}
        dispatch={dispatch}
        draft={mappedDraft()}
      />,
    );
    expect(screen.queryByText(/Shopify checkout is/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Approve demo cart · $518" }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "confirm-demo-cart" });
  });
});
