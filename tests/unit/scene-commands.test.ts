import { describe, expect, test } from "vitest";

import { createDemoScene } from "../../src/demo/demo-scene";
import { applySceneCommand } from "../../src/features/scene/scene-commands";
import {
  SceneSchema,
  type SceneProduct,
} from "../../src/features/scene/scene-schema";

const LIGHT_OAK_TABLE: SceneProduct = {
  id: "oak-frame-table",
  variantId: "demo-variant-oak-frame-table",
  title: "Oak Frame Table",
  category: "coffee_table",
  price: { amountMinor: 16900, currency: "USD" },
  dimensionsCm: { width: 105, height: 40, depth: 55 },
  styleTags: ["japandi", "light-oak"],
  color: "light-oak",
  material: "oak",
};

const CHAIR_PRODUCT: SceneProduct = {
  ...LIGHT_OAK_TABLE,
  id: "oak-chair",
  variantId: "demo-variant-oak-chair",
  title: "Oak Chair",
  category: "chair",
};

describe("applySceneCommand", () => {
  test("replaces a compatible object while preserving its horizontal transform", () => {
    const seed = createDemoScene();
    const seedTable = seed.objects.find(({ id }) => id === "table_01")!;

    const replaced = applySceneCommand(seed, {
      expectedRevision: 1,
      actor: "human",
      command: {
        type: "replace",
        objectId: "table_01",
        product: LIGHT_OAK_TABLE,
      },
    });

    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;

    const table = replaced.scene.objects.find(
      ({ id }) => id === "table_01",
    )!;
    expect(table.position[0]).toBe(seedTable.position[0]);
    expect(table.position[2]).toBe(seedTable.position[2]);
    expect(table.position[1]).toBe(0.2);
    expect(table.rotation).toEqual(seedTable.rotation);
    expect(table.dimensionsM).toEqual({
      width: 1.05,
      height: 0.4,
      depth: 0.55,
    });
    expect(table.product?.id).toBe("oak-frame-table");
    expect(table.source).toBe("product");
    expect(table.addedBy).toBe("human");
    expect(replaced.scene.revision).toBe(2);
    expect(SceneSchema.safeParse(replaced.scene).success).toBe(true);
  });

  test("rejects stale revisions without mutating the Scene", () => {
    const seed = createDemoScene();
    const result = applySceneCommand(seed, {
      expectedRevision: 9,
      actor: "agent",
      command: { type: "set-style", style: "warm japandi" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SCENE_REVISION_CONFLICT");
    expect(result.scene).toBe(seed);
    expect(result.scene.revision).toBe(1);
  });

  test("rejects replacement of a locked object", () => {
    const seed = createDemoScene();
    const preserved = applySceneCommand(seed, {
      expectedRevision: 1,
      actor: "human",
      command: { type: "preserve", objectId: "table_01", preserved: true },
    });
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;

    const result = applySceneCommand(preserved.scene, {
      expectedRevision: 2,
      actor: "agent",
      command: {
        type: "replace",
        objectId: "table_01",
        product: LIGHT_OAK_TABLE,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("OBJECT_LOCKED");
    expect(result.scene).toBe(preserved.scene);
  });

  test("rejects category mismatches", () => {
    const seed = createDemoScene();
    const result = applySceneCommand(seed, {
      expectedRevision: 1,
      actor: "agent",
      command: {
        type: "replace",
        objectId: "table_01",
        product: CHAIR_PRODUCT,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CATEGORY_MISMATCH");
  });

  test("clamps requested movement and reports the applied position", () => {
    const seed = createDemoScene();
    const result = applySceneCommand(seed, {
      expectedRevision: 1,
      actor: "agent",
      command: {
        type: "move",
        objectId: "lamp_01",
        position: { x: 99, z: -99 },
        rotationYDegrees: 90,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lamp = result.scene.objects.find(({ id }) => id === "lamp_01")!;
    expect(result.adjustedToFit).toBe(true);
    expect(result.appliedPosition).toEqual(lamp.position);
    expect(lamp.position[0]).toBeLessThan(3);
    expect(lamp.position[2]).toBeGreaterThan(-2.5);
    expect(lamp.rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(result.scene.revision).toBe(2);
  });

  test("sets style intent and toggles preserve through successful commands", () => {
    const seed = createDemoScene();
    const styled = applySceneCommand(seed, {
      expectedRevision: 1,
      actor: "agent",
      command: { type: "set-style", style: "warm japandi" },
    });
    expect(styled.ok).toBe(true);
    if (!styled.ok) return;
    expect(styled.scene.styleIntent).toBe("warm japandi");
    expect(styled.scene.revision).toBe(2);

    const preserved = applySceneCommand(styled.scene, {
      expectedRevision: 2,
      actor: "agent",
      command: { type: "preserve", objectId: "sofa_01", preserved: true },
    });
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;
    expect(
      preserved.scene.objects.find(({ id }) => id === "sofa_01")?.locked,
    ).toBe(true);

    const unpreserved = applySceneCommand(preserved.scene, {
      expectedRevision: 3,
      actor: "human",
      command: { type: "preserve", objectId: "sofa_01", preserved: false },
    });
    expect(unpreserved.ok).toBe(true);
    if (!unpreserved.ok) return;
    expect(
      unpreserved.scene.objects.find(({ id }) => id === "sofa_01")?.locked,
    ).toBe(false);
    expect(unpreserved.scene.revision).toBe(4);
  });
});
