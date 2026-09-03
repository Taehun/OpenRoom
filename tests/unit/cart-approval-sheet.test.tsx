import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommerceContext } from "../../src/features/commerce/commerce-types";
import { CartApprovalSheet } from "../../src/features/demo/cart-approval-sheet";
import type { CartApprovalDraft } from "../../src/webmcp/tool-context";
import {
  DEMO_COMMERCE,
  FIXTURE_VARIANTS,
  PLACEHOLDER_STORE_DOMAIN,
  SHOPIFY_COMMERCE,
} from "../helpers/commerce-fixtures";

const PERMALINK = `https://${PLACEHOLDER_STORE_DOMAIN}/cart/1001:1,1002:1`;

afterEach(() => {
  cleanup();
});

function agentDraft(): CartApprovalDraft {
  return {
    id: "scene-demo-rev-4",
    sceneId: "demo",
    sceneRevision: 4,
    items: [
      {
        objectId: "table_01",
        productId: "oak-frame-table",
        variantId: "demo-variant-oak-frame-table",
        title: "Oak Frame Table",
        quantity: 1,
        price: { amountMinor: 16900, currency: "USD" },
      },
      {
        objectId: "lamp_01",
        productId: "rice-paper-floor-lamp",
        variantId: "demo-variant-rice-paper-floor-lamp",
        title: "Rice Paper Floor Lamp",
        quantity: 1,
        price: { amountMinor: 14900, currency: "USD" },
      },
    ],
    totalMinor: 31800,
    commerce: {
      provider: "shopify",
      storeDomain: PLACEHOLDER_STORE_DOMAIN,
      mcpEndpoint: `https://${PLACEHOLDER_STORE_DOMAIN}/api/mcp`,
      lines: [
        {
          productId: "oak-frame-table",
          merchandiseId: "gid://shopify/ProductVariant/1003",
          quantity: 1,
        },
      ],
      skipped: [{ productId: "rice-paper-floor-lamp", reason: "unmapped" }],
      checkoutPermalink: `https://${PLACEHOLDER_STORE_DOMAIN}/cart/1003:1`,
    },
  };
}

describe("CartApprovalSheet in demo mode", () => {
  it("keeps the fixture cart demo-only", () => {
    const dispatch = vi.fn();
    render(<CartApprovalSheet commerce={DEMO_COMMERCE} dispatch={dispatch} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Shopify · $626" }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "confirm-demo-cart" });
    expect(screen.queryByText("Not mapped to a Shopify variant")).toBeNull();
  });
});

describe("CartApprovalSheet in shopify mode", () => {
  it("opens the fixture permalink in a new tab and announces it", () => {
    const dispatch = vi.fn();
    const openWindow = vi.fn(() => ({ opener: {} }) as unknown as Window);
    render(
      <CartApprovalSheet
        commerce={SHOPIFY_COMMERCE}
        dispatch={dispatch}
        openWindow={openWindow}
      />,
    );
    expect(
      screen.getByText(PLACEHOLDER_STORE_DOMAIN, { exact: false }),
    ).toBeVisible();
    expect(
      screen.getAllByText("Not mapped to a Shopify variant"),
    ).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Shopify · $438" }),
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
        openWindow={openWindow}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Shopify · $438" }),
    );
    const link = screen.getByRole("link", { name: "Open Shopify checkout" });
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
    expect(openWindow).toHaveBeenCalledWith(
      `https://${PLACEHOLDER_STORE_DOMAIN}/cart/1003:1`,
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "open-external-checkout",
      itemCount: 1,
    });
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
      />,
    );
    expect(screen.queryByText(/Shopify checkout is/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Shopify · $626" }),
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "confirm-demo-cart" });
  });
});
