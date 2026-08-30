import { describe, expect, test } from "vitest";
import { createInitialDemoState, demoReducer } from "../../src/features/demo/demo-state";

describe("demoReducer", () => {
  test("previews the selected product as a reversible scene change", () => {
    const initial = createInitialDemoState();
    const products = demoReducer(initial, { type: "show-products" });
    const preview = demoReducer(products, {
      type: "preview-product",
      productId: "oak-frame-table",
    });

    expect(preview).toMatchObject({
      mode: "products",
      previewProductId: "oak-frame-table",
      provider: "Cached",
      revision: 2,
      roomTotalMinor: 16900,
    });
    expect(demoReducer(preview, { type: "undo" })).toMatchObject({
      mode: "products",
      previewProductId: null,
      revision: 1,
      roomTotalMinor: 0,
    });
  });

  test("records an agent move and reset returns the canonical revision", () => {
    const moved = demoReducer(createInitialDemoState(), {
      type: "run-agent-move",
    });
    expect(moved).toMatchObject({ mode: "activity", revision: 2 });
    expect(moved.toast?.message).toBe("Lamp moved to match your layout");
    expect(demoReducer(moved, { type: "reset" })).toEqual(
      createInitialDemoState(),
    );
  });
});
