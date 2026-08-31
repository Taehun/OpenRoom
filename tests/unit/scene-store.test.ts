import { describe, expect, test } from "vitest";

import { createSceneStore } from "../../src/features/scene/scene-store";

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

    store.getState().setTransforming(true);
    const result = store
      .getState()
      .commitTransform(
        "chair_01",
        [before.position[0] - 0.25, before.position[1], 0.75],
        Math.PI / 4,
      );

    expect(result.ok).toBe(true);
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().scene.revision).toBe(2);
    expect(store.getState().stateVersion).toBe(2);
    const chair = store
      .getState()
      .scene.objects.find(({ id }) => id === "chair_01")!;
    expect(chair.position[2]).toBe(0.75);
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
});
