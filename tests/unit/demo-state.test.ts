import { describe, expect, test } from "vitest";

import {
  createInitialDemoState,
  demoReducer,
} from "../../src/features/demo/demo-state";

describe("demoReducer", () => {
  test("owns only panel, cart, toast, and announcement state", () => {
    expect(createInitialDemoState()).toEqual({
      mode: "inspector",
      isCartOpen: false,
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
});
