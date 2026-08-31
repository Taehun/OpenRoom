import { describe, expect, test } from "vitest";

import {
  createInitialDemoState,
  demoReducer,
} from "../../src/features/demo/demo-state";
import type { CartApprovalDraft } from "../../src/webmcp/tool-context";

const AGENT_CART_DRAFT: CartApprovalDraft = {
  id: "scene-demo-living-room-rev-2",
  sceneId: "demo-living-room",
  sceneRevision: 2,
  items: [
    {
      objectId: "table_01",
      productId: "travertine-plinth-table",
      variantId: "demo-variant-travertine-plinth-table",
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
      cartDraft: null,
      toast: null,
      announcement: null,
    });
    expect(preview).not.toHaveProperty("revision");
    expect(preview).not.toHaveProperty("history");
  });

  test("records Agent disclosure and reset restores the canonical UI state", () => {
    const moved = demoReducer(createInitialDemoState(), {
      type: "run-agent-move",
    });
    expect(moved.mode).toBe("activity");
    expect(moved.toast?.message).toBe("Lamp moved to match your layout");
    expect(demoReducer(moved, { type: "reset" })).toEqual(
      createInitialDemoState(),
    );
  });

  test("keeps cart confirmation local and explicit", () => {
    const opened = demoReducer(createInitialDemoState(), {
      type: "open-cart",
    });
    const confirmed = demoReducer(opened, { type: "confirm-demo-cart" });

    expect(confirmed.isCartOpen).toBe(false);
    expect(confirmed.announcement).toBe(
      "Demo only — no external cart was created.",
    );
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
    expect(
      demoReducer(agentCart, { type: "confirm-demo-cart" }).cartDraft,
    ).toBeNull();
    expect(demoReducer(agentCart, { type: "reset" }).cartDraft).toBeNull();
  });
});
