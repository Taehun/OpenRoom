import { describe, expect, test } from "vitest";

import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import {
  createSceneStore,
  type SceneCommitEvent,
  type SceneStore,
} from "../../src/features/scene/scene-store";
import type {
  CommandActor,
  CommandResult,
  Scene,
  SceneProduct,
} from "../../src/features/scene/scene-schema";
import { supportOf } from "../../src/features/scene/support";
import { completedProductScene } from "../helpers/natural-placement-fixtures";

function sceneProductFor(
  type: Scene["objects"][number]["type"],
  productId?: string,
): SceneProduct {
  const product = DEMO_PRODUCTS.find(({ id, category }) =>
    productId === undefined ? category === type : id === productId
  );
  if (!product) throw new Error(`Missing demo product for ${type}`);
  return {
    id: product.id,
    variantId: product.variantId,
    title: product.title,
    category: product.category,
    price: structuredClone(product.price),
    dimensionsCm: structuredClone(product.dimensionsCm),
    styleTags: [...product.styleTags],
    color: product.color,
    material: product.material,
  };
}

function replaceDemoObject(
  store: SceneStore,
  objectId: string,
  actor: CommandActor = "agent",
  productId?: string,
): CommandResult {
  const object = store.getState().scene.objects.find(({ id }) => id === objectId);
  if (!object) throw new Error(`Missing demo object ${objectId}`);
  return store.getState().applyCommand({
    expectedRevision: store.getState().scene.revision,
    actor,
    command: {
      type: "replace",
      objectId,
      product: sceneProductFor(object.type, productId),
    },
  });
}

function placementById(scene: Scene) {
  return Object.fromEntries(
    scene.objects.map(({ id, position, rotation }) => [
      id,
      { x: position[0], z: position[2], rotationY: rotation[1] },
    ]),
  );
}

describe("createSceneStore", () => {
  test("keeps selection revision-neutral and restores a command through undo", () => {
    const store = createSceneStore();

    store.getState().selectObject("chair_01");
    expect(store.getState().scene.selectedObjectId).toBe("chair_01");
    expect(store.getState().scene.revision).toBe(1);
    expect(store.getState().stateVersion).toBe(2);

    const result = store.getState().applyCommand({
      expectedRevision: 1,
      actor: "human",
      command: { type: "preserve", objectId: "sofa_01", preserved: true },
    });
    expect(result.ok).toBe(true);
    expect(store.getState().scene.revision).toBe(2);
    expect(store.getState().stateVersion).toBe(3);
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().scene.revision).toBe(1);
    expect(store.getState().stateVersion).toBe(4);
    expect(store.getState().scene.selectedObjectId).toBe("chair_01");
    expect(store.getState().history).toHaveLength(0);
  });

  test("does not add history when a command is stale", () => {
    const store = createSceneStore();
    const result = store.getState().applyCommand({
      expectedRevision: 4,
      actor: "agent",
      command: { type: "set-style", style: "warm japandi" },
    });

    expect(result.ok).toBe(false);
    expect(store.getState().scene.revision).toBe(1);
    expect(store.getState().history).toHaveLength(0);
    expect(store.getState().stateVersion).toBe(1);
  });

  test("keeps a revision-neutral selection made after the command through undo", () => {
    const store = createSceneStore();

    store.getState().applyCommand({
      expectedRevision: 1,
      actor: "agent",
      command: {
        type: "move",
        objectId: "lamp_01",
        position: { x: 2.1, z: -1.8 },
      },
    });
    store.getState().selectObject("lamp_01");

    expect(store.getState().stateVersion).toBe(3);

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().scene.revision).toBe(1);
    expect(store.getState().scene.selectedObjectId).toBe("lamp_01");
    expect(store.getState().stateVersion).toBe(4);
  });

  test("caps command history at thirty snapshots", () => {
    const store = createSceneStore();

    for (let index = 0; index < 35; index += 1) {
      const result = store.getState().applyCommand({
        expectedRevision: index + 1,
        actor: "agent",
        command: { type: "set-style", style: `style-${index}` },
      });
      expect(result.ok).toBe(true);
    }

    expect(store.getState().scene.revision).toBe(36);
    expect(store.getState().history).toHaveLength(30);
    expect(store.getState().history[0].revision).toBe(6);
    expect(store.getState().history[29].revision).toBe(35);
    expect(store.getState().stateVersion).toBe(36);
  });

  test("commits one transform as one command and one history entry", () => {
    const store = createSceneStore();
    const before = store
      .getState()
      .scene.objects.find(({ id }) => id === "chair_01")!;

    // A 45-degree chair reaches half its diagonal past its centre, so this small
    // forward move stays inside the inset and clear of the centred table.
    const targetZ = 0.65;
    store.getState().setTransforming(true);
    const result = store
      .getState()
      .commitTransform(
        "chair_01",
        [before.position[0], before.position[1], targetZ],
        Math.PI / 4,
      );

    expect(result.ok).toBe(true);
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().scene.revision).toBe(2);
    expect(store.getState().stateVersion).toBe(2);
    const chair = store
      .getState()
      .scene.objects.find(({ id }) => id === "chair_01")!;
    expect(chair.position[2]).toBe(targetZ);
    expect(chair.rotation[1]).toBeCloseTo(Math.PI / 4);
  });

  test("reset restores the canonical seed and all transient store state", () => {
    const store = createSceneStore();
    store.getState().selectObject("plant_01");
    store.getState().setToolMode("rotate");
    store.getState().setTransforming(true);
    store.getState().applyCommand({
      expectedRevision: 1,
      actor: "human",
      command: { type: "set-style", style: "warm japandi" },
    });

    store.getState().reset();

    expect(store.getState().resetVersion).toBe(1);
    expect(store.getState().stateVersion).toBe(4);
    expect(store.getState().scene.revision).toBe(1);
    expect(store.getState().scene.selectedObjectId).toBe("table_01");
    expect(store.getState().scene.styleIntent).toBeNull();
    expect(store.getState().toolMode).toBe("select");
    expect(store.getState().isTransforming).toBe(false);
    expect(store.getState().history).toHaveLength(0);
    expect(store.getState().undo()).toBe(false);
  });

  test("ignores selection ids that do not exist", () => {
    const store = createSceneStore();
    store.getState().selectObject("missing_01");

    expect(store.getState().scene.selectedObjectId).toBe("table_01");
    expect(store.getState().scene.revision).toBe(1);
    expect(store.getState().stateVersion).toBe(1);
  });

  // Re-picking the active tool or the already-selected rail item used to be a
  // silent no-op, which left the arrow keys stranded on the rail button.
  test("counts every selection and tool pick as a focus request", () => {
    const store = createSceneStore();
    expect(store.getState().focusRequest).toBe(0);

    store.getState().selectObject("chair_01");
    expect(store.getState().focusRequest).toBe(1);

    store.getState().selectObject("chair_01");
    expect(store.getState().focusRequest).toBe(2);
    expect(store.getState().stateVersion).toBe(2);

    store.getState().setToolMode("rotate");
    expect(store.getState().focusRequest).toBe(3);

    store.getState().setToolMode("rotate");
    expect(store.getState().focusRequest).toBe(4);
    expect(store.getState().toolMode).toBe("rotate");

    // An id that is not in the Scene is not a request for anything.
    store.getState().selectObject("missing_01");
    expect(store.getState().focusRequest).toBe(4);
  });

  test("increments stateVersion only for actual selection changes", () => {
    const store = createSceneStore();

    store.getState().selectObject("table_01");
    expect(store.getState().stateVersion).toBe(1);

    store.getState().selectObject("chair_01");
    expect(store.getState().stateVersion).toBe(2);

    store.getState().selectObject("chair_01");
    store.getState().selectObject("missing_01");
    expect(store.getState().stateVersion).toBe(2);

    store.getState().selectObject(null);
    expect(store.getState().stateVersion).toBe(3);
  });

  // Each replacement is one command commit. A larger product may move itself to the
  // nearest open floor position, but it never pushes another object out of the way.
  test("completes a collision-free agent redesign by moving only replaced pieces", () => {
    const events: SceneCommitEvent[] = [];
    const store = createSceneStore(undefined, {
      onCommit: (event) => events.push(event),
    });
    const objectIds = store.getState().scene.objects.map(({ id }) => id);

    for (const objectId of objectIds.slice(0, -1)) {
      const before = placementById(store.getState().scene);
      expect(replaceDemoObject(store, objectId).ok).toBe(true);
      const after = placementById(store.getState().scene);
      for (const otherId of objectIds) {
        if (otherId !== objectId) expect(after[otherId]).toEqual(before[otherId]);
      }
    }

    const beforeFinal = structuredClone(store.getState().scene);
    const beforeFinalPlacements = placementById(beforeFinal);
    const result = replaceDemoObject(
      store,
      objectIds.at(-1)!,
      "agent",
      "stoneware-snake-plant",
    );

    expect(result).toMatchObject({
      ok: true,
      scene: { revision: beforeFinal.revision + 1 },
    });
    expect(store.getState().scene).toEqual(result.scene);
    const afterFinalPlacements = placementById(store.getState().scene);
    for (const otherId of objectIds.slice(0, -1)) {
      expect(afterFinalPlacements[otherId]).toEqual(beforeFinalPlacements[otherId]);
    }
    expect(store.getState().stateVersion).toBe(7);
    expect(store.getState().history).toHaveLength(6);
    expect(store.getState().history.at(-1)).toEqual(beforeFinal);
    expect(
      store.getState().scene.objects.every(({ source }) => source === "product"),
    ).toBe(true);
    expect(events).toHaveLength(6);
    expect(events.at(-1)).toEqual({
      cause: "replace",
      revision: beforeFinal.revision + 1,
      scene: store.getState().scene,
    });
    expect(events.at(-1)!.scene).not.toBe(store.getState().scene);

    // One undo restores the last replacement and nothing else moved with it.
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().scene).toEqual(beforeFinal);
  });

  test("publishes a deep post-install snapshot and ignores observer exceptions", () => {
    let installedDuringCallback: Scene | undefined;
    const store = createSceneStore(completedProductScene(), {
      onCommit: (event) => {
        installedDuringCallback = structuredClone(store.getState().scene);
        event.scene.objects[0]!.position[0] = 999;
        throw new Error("renderer fault");
      },
    });
    const chair = store
      .getState()
      .scene.objects.find(({ id }) => id === "chair_01")!;

    const result = store
      .getState()
      .commitTransform(
        "chair_01",
        [chair.position[0], chair.position[1], chair.position[2] + 0.1],
      );

    expect(result.ok).toBe(true);
    expect(installedDuringCallback).toEqual(store.getState().scene);
    expect(store.getState().scene.objects[0]!.position[0]).not.toBe(999);
  });
});

describe("lamp stacking through the store", () => {
  function tableCentre(store: SceneStore) {
    const table = store
      .getState()
      .scene.objects.find(({ id }) => id === "table_01")!;
    return { x: table.position[0], z: table.position[2] };
  }

  test("recomputes elevation on a move and again on a replacement", () => {
    const store = createSceneStore();
    const table = store
      .getState()
      .scene.objects.find(({ id }) => id === "table_01")!;

    const moved = store.getState().applyCommand({
      expectedRevision: store.getState().scene.revision,
      actor: "agent",
      command: { type: "move", objectId: "lamp_01", position: tableCentre(store) },
    });
    expect(moved.ok).toBe(true);

    const raised = store
      .getState()
      .scene.objects.find(({ id }) => id === "lamp_01")!;
    expect(supportOf(store.getState().scene, raised)?.id).toBe("table_01");
    expect(raised.position[1]).toBeCloseTo(
      table.dimensionsM.height + raised.dimensionsM.height / 2,
      9,
    );

    // Replacing the table changes the height the lamp stands at, without a move.
    const replaced = replaceDemoObject(store, "table_01", "human");
    expect(replaced.ok).toBe(true);
    const newTable = store
      .getState()
      .scene.objects.find(({ id }) => id === "table_01")!;
    const settledLamp = store
      .getState()
      .scene.objects.find(({ id }) => id === "lamp_01")!;
    expect(settledLamp.position[1]).toBeCloseTo(
      newTable.dimensionsM.height + settledLamp.dimensionsM.height / 2,
      9,
    );
  });

  test("commits a transform through the same settling path and undoes it", () => {
    const store = createSceneStore();
    const before = structuredClone(store.getState().scene);
    const centre = tableCentre(store);

    const result = store
      .getState()
      .commitTransform("lamp_01", [centre.x, 0, centre.z]);
    expect(result.ok).toBe(true);
    expect(
      store.getState().scene.objects.find(({ id }) => id === "lamp_01")!
        .position[1],
    ).toBeGreaterThan(1);

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().scene.objects).toEqual(before.objects);
  });
});
