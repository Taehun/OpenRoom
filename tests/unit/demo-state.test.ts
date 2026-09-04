import { describe, expect, test } from "vitest";

import {
  createInitialDemoState,
  demoReducer,
} from "../../src/features/demo/demo-state";
import type { CartReviewDraft } from "../../src/webmcp/tool-context";

const AGENT_CART_DRAFT: CartReviewDraft = {
  id: "scene-demo-living-room-rev-2",
  sceneId: "demo-living-room",
  sceneRevision: 2,
  items: [
    {
      objectId: "table_01",
      productId: "travertine-plinth-table",
      demoVariantId: "demo-variant-travertine-plinth-table",
      title: "Travertine Plinth Table",
      quantity: 1,
      price: { amountMinor: 24900, currency: "USD" },
    },
  ],
  totalMinor: 24900,
};

describe("demoReducer", () => {
  test("owns only panel, cart, toast, and announcement state", () => {
    expect(createInitialDemoState()).toEqual({
      mode: "inspector",
      isCartOpen: false,
      isStoreSettingsOpen: false,
      cartDraft: null,
      toast: null,
      announcement: null,
    });

    const preview = demoReducer(createInitialDemoState(), {
      type: "preview-product",
      productId: "oak-frame-table",
    });
    expect(preview).toEqual({
      mode: "products",
      isCartOpen: false,
      isStoreSettingsOpen: false,
      cartDraft: null,
      toast: null,
      announcement: null,
    });
    expect(preview).not.toHaveProperty("revision");
    expect(preview).not.toHaveProperty("history");
  });

  test("reset restores the canonical UI state and says so", () => {
    const products = demoReducer(createInitialDemoState(), {
      type: "show-products",
    });
    const reset = demoReducer(products, { type: "reset" });
    expect(reset).toEqual({
      ...createInitialDemoState(),
      announcement: {
        text: "Room reset to the original furniture",
        nonce: expect.any(Number),
        tone: "quiet",
      },
    });
  });

  // Nothing on screen reports an undo, a reset, or a cleared selection, so each
  // is said quietly — to the screen reader only, never over the room.
  test("announces silent edits quietly and approvals as a toast", () => {
    expect(
      demoReducer(createInitialDemoState(), { type: "undo" }).announcement,
    ).toMatchObject({ text: "Undo: last change reverted", tone: "quiet" });

    expect(
      demoReducer(createInitialDemoState(), {
        type: "select-object",
        objectId: null,
      }).announcement,
    ).toMatchObject({ text: "Selection cleared", tone: "quiet" });

    expect(
      demoReducer(createInitialDemoState(), {
        type: "select-object",
        objectId: "sofa_01",
      }).announcement,
    ).toBeNull();
  });

  // The sheet is the next thing to read: a leftover toast sits over its
  // "Keep editing" action.
  test("clears any standing announcement when the cart opens", () => {
    const approved = demoReducer(createInitialDemoState(), {
      type: "open-external-checkout",
      itemCount: 1,
    });
    expect(approved.announcement).not.toBeNull();
    expect(demoReducer(approved, { type: "open-cart" }).announcement).toBeNull();
  });

  test("moves from the cart to store settings without leaving both overlays open", () => {
    const cart = demoReducer(createInitialDemoState(), { type: "open-cart" });
    const settings = demoReducer(cart, { type: "open-store-settings" });
    expect(settings).toMatchObject({
      isCartOpen: false,
      isStoreSettingsOpen: true,
      cartDraft: null,
    });
    expect(
      demoReducer(settings, { type: "close-store-settings" }),
    ).toMatchObject({ isStoreSettingsOpen: false });
  });

  test("clears the announcement once and returns the same state when there is none", () => {
    const opened = demoReducer(createInitialDemoState(), { type: "open-cart" });
    const confirmed = demoReducer(opened, {
      type: "open-external-checkout",
      itemCount: 1,
    });
    const cleared = demoReducer(confirmed, { type: "clear-announcement" });
    expect(cleared.announcement).toBeNull();
    expect(cleared.isCartOpen).toBe(false);
    expect(demoReducer(cleared, { type: "clear-announcement" })).toBe(cleared);
  });

  test("clears an Agent cart draft without changing the fixture cart mode", () => {
    const fixtureCart = demoReducer(createInitialDemoState(), {
      type: "open-cart",
    });
    expect(fixtureCart).toMatchObject({ isCartOpen: true, cartDraft: null });

    const agentCart = demoReducer(createInitialDemoState(), {
      type: "open-cart",
      draft: AGENT_CART_DRAFT,
    });
    expect(agentCart).toMatchObject({
      isCartOpen: true,
      cartDraft: AGENT_CART_DRAFT,
    });

    expect(demoReducer(agentCart, { type: "close-cart" }).cartDraft).toBeNull();
    expect(demoReducer(agentCart, { type: "reset" }).cartDraft).toBeNull();
  });

  test("closes the cart and announces an external checkout", () => {
    const opened = demoReducer(createInitialDemoState(), { type: "open-cart" });
    const closed = demoReducer(opened, {
      type: "open-external-checkout",
      itemCount: 2,
    });
    expect(closed.isCartOpen).toBe(false);
    expect(closed.cartDraft).toBeNull();
    expect(closed.announcement).toMatchObject({
      text: "Opened Shopify checkout in a new tab (2 items)",
      tone: "toast",
    });
    expect(
      demoReducer(opened, { type: "open-external-checkout", itemCount: 1 })
        .announcement,
    ).toMatchObject({
      text: "Opened Shopify checkout in a new tab (1 item)",
      tone: "toast",
    });
  });
});
