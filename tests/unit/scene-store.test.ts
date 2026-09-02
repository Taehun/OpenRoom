import { describe, expect, test, vi } from "vitest";

import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import { proposeNaturalPlacement } from "../../src/features/placement/natural-placement";
import type { NaturalPlacementResult } from "../../src/features/placement/placement-types";
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
import { completedProductScene } from "../helpers/natural-placement-fixtures";

function sceneProductFor(type: Scene["objects"][number]["type"]): SceneProduct {
  const product = DEMO_PRODUCTS.find(({ category }) => category === type);
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
): CommandResult {
  const object = store.getState().scene.objects.find(({ id }) => id === objectId);
  if (!object) throw new Error(`Missing demo object ${objectId}`);
  return store.getState().applyCommand({
    expectedRevision: store.getState().scene.revision,
    actor,
    command: {
      type: "replace",
      objectId,
      product: sceneProductFor(object.type),
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

function changedObjectIds(before: Scene, after: Scene) {
  const prior = placementById(before);
  return after.objects.flatMap(({ id, position, rotation }) => {
    const value = prior[id];
    return value &&
      value.x === position[0] &&
      value.z === position[2] &&
      value.rotationY === rotation[1]
      ? []
      : [id];
  });
}

function completeFirstFive(store: SceneStore) {
  const ids = store.getState().scene.objects.map(({ id }) => id);
  for (const objectId of ids.slice(0, -1)) {
    expect(replaceDemoObject(store, objectId).ok).toBe(true);
  }
  return ids.at(-1)!;
}

const COMPLETE_PLACEMENT_PROPOSAL = (() => {
  const proposal = proposeNaturalPlacement(completedProductScene());
  if (proposal.kind !== "changed") {
    throw new Error(`Expected a changed proposal, received ${proposal.kind}`);
  }
  return proposal;
})();

function completePlacementProposal() {
  return structuredClone(COMPLETE_PLACEMENT_PROPOSAL);
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

  test("commits natural placement once and one undo restores every object", () => {
    const events: SceneCommitEvent[] = [];
    const store = createSceneStore(completedProductScene(), {
      onCommit: (event) => events.push(event),
    });
    const before = structuredClone(store.getState().scene);
    const stateVersion = store.getState().stateVersion;
    const result = store.getState().arrangeNaturally();

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(store.getState().scene.revision).toBe(before.revision + 1);
    expect(store.getState().stateVersion).toBe(stateVersion + 1);
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().scene.selectedObjectId).toBe(before.selectedObjectId);
    expect(store.getState().placementNotice).toMatchObject({
      id: 1,
      kind: "manual-arranged",
      message: "Placement improved",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ cause: "move", revision: before.revision + 1 });

    expect(store.getState().undo()).toBe(true);
    expect(store.getState().scene).toEqual(before);
    expect(store.getState().placementNotice).toBeNull();
    expect(events).toHaveLength(1);
  });

  test.each([
    {
      name: "an unchanged proposal",
      proposal: {
        kind: "unchanged",
        reason: "already-safe",
        diagnostics: { currentScore: 10, proposedScore: 10, evaluatedLayouts: 1 },
      } satisfies NaturalPlacementResult,
      expected: { ok: true, changed: false },
      notice: {
        kind: "manual-unchanged",
        message: "Current placement is already the safest option",
      },
    },
    {
      name: "a failed proposal",
      proposal: {
        kind: "failed",
        reason: "no-valid-layout",
      } satisfies NaturalPlacementResult,
      expected: { ok: false, changed: false, reason: "no-valid-layout" },
      notice: {
        kind: "manual-failed",
        message: "Could not improve placement; the room was left unchanged",
      },
    },
  ])("leaves canonical state untouched for $name", ({ proposal, expected, notice }) => {
    const events: SceneCommitEvent[] = [];
    const store = createSceneStore(completedProductScene(), {
      proposePlacement: () => proposal,
      onCommit: (event) => events.push(event),
    });
    const before = store.getState();

    expect(store.getState().arrangeNaturally()).toMatchObject(expected);

    expect(store.getState().scene).toBe(before.scene);
    expect(store.getState().history).toBe(before.history);
    expect(store.getState().stateVersion).toBe(before.stateVersion);
    expect(store.getState().placementNotice).toMatchObject(notice);
    expect(events).toEqual([]);
  });

  test("treats a thrown manual proposer exception as an unexpected atomic failure", () => {
    const events: SceneCommitEvent[] = [];
    const store = createSceneStore(completedProductScene(), {
      proposePlacement: () => {
        throw new Error("solver fault");
      },
      onCommit: (event) => events.push(event),
    });
    const before = store.getState();

    expect(store.getState().arrangeNaturally()).toEqual({
      ok: false,
      changed: false,
      scene: before.scene,
      reason: "unexpected",
    });
    expect(store.getState().scene).toBe(before.scene);
    expect(store.getState().history).toBe(before.history);
    expect(store.getState().stateVersion).toBe(before.stateVersion);
    expect(store.getState().placementNotice).toMatchObject({
      kind: "manual-failed",
      message: "Could not improve placement; the room was left unchanged",
    });
    expect(events).toEqual([]);
  });

  test.each([
    {
      name: "unchanged",
      outcome: {
        kind: "unchanged" as const,
        reason: "already-safe" as const,
        diagnostics: { currentScore: 1, proposedScore: 1, evaluatedLayouts: 1 },
      },
      expected: { ok: true, changed: false },
    },
    {
      name: "failed",
      outcome: { kind: "failed" as const, reason: "no-valid-layout" as const },
      expected: { ok: false, changed: false, reason: "no-valid-layout" },
    },
  ])("isolates canonical state when a manual proposer mutates then returns $name", ({
    outcome,
    expected,
  }) => {
    const events: SceneCommitEvent[] = [];
    const store = createSceneStore(completedProductScene(), {
      proposePlacement: (scene) => {
        scene.objects[0]!.position[0] = 999;
        return outcome;
      },
      onCommit: (event) => events.push(event),
    });
    const beforeState = store.getState();
    const beforeScene = structuredClone(beforeState.scene);

    expect(store.getState().arrangeNaturally()).toMatchObject(expected);

    expect(store.getState().scene).toBe(beforeState.scene);
    expect(store.getState().scene).toEqual(beforeScene);
    expect(store.getState().history).toBe(beforeState.history);
    expect(store.getState().stateVersion).toBe(beforeState.stateVersion);
    expect(events).toEqual([]);
  });

  test("isolates canonical state when a manual proposer mutates then throws", () => {
    const events: SceneCommitEvent[] = [];
    const store = createSceneStore(completedProductScene(), {
      proposePlacement: (scene) => {
        scene.objects[0]!.position[0] = 999;
        throw new Error("solver fault");
      },
      onCommit: (event) => events.push(event),
    });
    const beforeState = store.getState();
    const beforeScene = structuredClone(beforeState.scene);

    expect(store.getState().arrangeNaturally()).toEqual({
      ok: false,
      changed: false,
      scene: beforeState.scene,
      reason: "unexpected",
    });
    expect(store.getState().scene).toBe(beforeState.scene);
    expect(store.getState().scene).toEqual(beforeScene);
    expect(store.getState().history).toBe(beforeState.history);
    expect(store.getState().stateVersion).toBe(beforeState.stateVersion);
    expect(events).toEqual([]);
  });

  test("rejects an incomplete manual proposal without partially moving objects", () => {
    const scene = completedProductScene();
    const proposal = completePlacementProposal();
    const incomplete = {
      ...structuredClone(proposal),
      placements: proposal.placements.map((placement) =>
        structuredClone(placement),
      ),
    };
    incomplete.placements.pop();
    const events: SceneCommitEvent[] = [];
    const store = createSceneStore(scene, {
      proposePlacement: () => incomplete,
      onCommit: (event) => events.push(event),
    });
    const before = store.getState();

    expect(store.getState().arrangeNaturally()).toEqual({
      ok: false,
      changed: false,
      scene: before.scene,
      reason: "invalid-input",
    });
    expect(store.getState().scene).toBe(before.scene);
    expect(store.getState().history).toBe(before.history);
    expect(store.getState().stateVersion).toBe(before.stateVersion);
    expect(store.getState().placementNotice).toMatchObject({
      kind: "manual-failed",
      message: "Could not improve placement; the room was left unchanged",
    });
    expect(events).toEqual([]);
  });

  test("folds the first completed agent redesign into one replace commit", () => {
    const events: SceneCommitEvent[] = [];
    const store = createSceneStore(undefined, {
      onCommit: (event) => events.push(event),
    });
    const seedPlacements = placementById(store.getState().scene);
    const objectIds = store.getState().scene.objects.map(({ id }) => id);

    for (const objectId of objectIds.slice(0, -1)) {
      const result = replaceDemoObject(store, objectId);
      expect(result.ok).toBe(true);
      expect(placementById(store.getState().scene)).toEqual(seedPlacements);
    }

    const beforeFinal = structuredClone(store.getState().scene);
    const priorEventCount = events.length;
    const result = replaceDemoObject(store, objectIds.at(-1)!);

    expect(result).toMatchObject({
      ok: true,
      placementOutcome: { kind: "auto-arranged" },
      scene: { revision: beforeFinal.revision + 1 },
    });
    expect(store.getState().scene).toEqual(result.scene);
    expect(store.getState().stateVersion).toBe(7);
    expect(store.getState().history).toHaveLength(6);
    expect(store.getState().history.at(-1)).toEqual(beforeFinal);
    expect(changedObjectIds(beforeFinal, store.getState().scene).length).toBeGreaterThan(1);
    expect(store.getState().placementNotice).toMatchObject({
      kind: "auto-arranged",
      message: "Redesign arranged",
    });
    expect(events).toHaveLength(priorEventCount + 1);
    expect(events.at(-1)).toEqual({
      cause: "replace",
      revision: beforeFinal.revision + 1,
      scene: store.getState().scene,
    });
    expect(events.at(-1)!.scene).not.toBe(store.getState().scene);
  });

  test("does not auto-arrange when a human completes the redesign", () => {
    const proposePlacement = vi.fn(() => ({
      kind: "failed" as const,
      reason: "unexpected" as const,
    }));
    const store = createSceneStore(undefined, { proposePlacement });
    const lastObjectId = completeFirstFive(store);
    const beforeFinal = structuredClone(store.getState().scene);

    const result = replaceDemoObject(store, lastObjectId, "human");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placementOutcome).toBeUndefined();
    expect(placementById(result.scene)).toEqual(placementById(beforeFinal));
    expect(store.getState().placementNotice).toBeNull();
    expect(proposePlacement).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: "an unchanged automatic proposal",
      propose: () => ({
        kind: "unchanged" as const,
        reason: "already-safe" as const,
        diagnostics: { currentScore: 1, proposedScore: 1, evaluatedLayouts: 1 },
      }),
    },
    {
      name: "a failed automatic proposal",
      propose: () => ({ kind: "failed" as const, reason: "no-valid-layout" as const }),
    },
    {
      name: "a thrown automatic exception",
      propose: () => {
        throw new Error("solver fault");
      },
    },
  ])("retains a valid final replacement for $name", ({ propose }) => {
    const events: SceneCommitEvent[] = [];
    const store = createSceneStore(undefined, {
      proposePlacement: propose,
      onCommit: (event) => events.push(event),
    });
    const lastObjectId = completeFirstFive(store);
    const before = structuredClone(store.getState().scene);
    const beforeEvents = events.length;

    const result = replaceDemoObject(store, lastObjectId);

    expect(result).toMatchObject({
      ok: true,
      placementOutcome: { kind: "auto-retained" },
      scene: { revision: before.revision + 1 },
    });
    expect(store.getState().stateVersion).toBe(7);
    expect(store.getState().history).toHaveLength(6);
    expect(placementById(store.getState().scene)).toEqual(placementById(before));
    expect(store.getState().scene.objects.find(({ id }) => id === lastObjectId)?.source)
      .toBe("product");
    expect(store.getState().placementNotice).toMatchObject({
      kind: "auto-retained",
      message: "Redesign updated; placement retained",
    });
    expect(events).toHaveLength(beforeEvents + 1);
    expect(events.at(-1)).toMatchObject({
      cause: "replace",
      revision: before.revision + 1,
    });
  });

  test.each([
    {
      name: "unchanged",
      outcome: {
        kind: "unchanged" as const,
        reason: "already-safe" as const,
        diagnostics: { currentScore: 1, proposedScore: 1, evaluatedLayouts: 1 },
      },
    },
    {
      name: "failed",
      outcome: { kind: "failed" as const, reason: "no-valid-layout" as const },
    },
  ])("retains an untouched replacement when an automatic proposer mutates then returns $name", ({
    outcome,
  }) => {
    const events: SceneCommitEvent[] = [];
    const store = createSceneStore(undefined, {
      proposePlacement: (scene) => {
        scene.objects[0]!.position[0] = 999;
        return outcome;
      },
      onCommit: (event) => events.push(event),
    });
    const lastObjectId = completeFirstFive(store);
    const before = structuredClone(store.getState().scene);
    const priorEvents = events.length;

    const result = replaceDemoObject(store, lastObjectId);

    expect(result).toMatchObject({
      ok: true,
      placementOutcome: { kind: "auto-retained" },
      scene: { revision: before.revision + 1 },
    });
    expect(store.getState().scene).toBe(result.scene);
    expect(placementById(store.getState().scene)).toEqual(placementById(before));
    expect(store.getState().scene.objects[0]!.position[0]).not.toBe(999);
    expect(store.getState().scene.objects.find(({ id }) => id === lastObjectId)?.source)
      .toBe("product");
    expect(store.getState().history).toHaveLength(6);
    expect(store.getState().history.at(-1)).toEqual(before);
    expect(store.getState().stateVersion).toBe(7);
    expect(events).toHaveLength(priorEvents + 1);
    expect(events.at(-1)).toEqual({
      cause: "replace",
      revision: before.revision + 1,
      scene: store.getState().scene,
    });
  });

  test("retains an untouched replacement when an automatic proposer mutates then throws", () => {
    const events: SceneCommitEvent[] = [];
    const store = createSceneStore(undefined, {
      proposePlacement: (scene) => {
        scene.objects[0]!.position[0] = 999;
        throw new Error("solver fault");
      },
      onCommit: (event) => events.push(event),
    });
    const lastObjectId = completeFirstFive(store);
    const before = structuredClone(store.getState().scene);
    const priorEvents = events.length;

    const result = replaceDemoObject(store, lastObjectId);

    expect(result).toMatchObject({
      ok: true,
      placementOutcome: { kind: "auto-retained" },
      scene: { revision: before.revision + 1 },
    });
    expect(store.getState().scene).toBe(result.scene);
    expect(placementById(store.getState().scene)).toEqual(placementById(before));
    expect(store.getState().scene.objects[0]!.position[0]).not.toBe(999);
    expect(store.getState().scene.objects.find(({ id }) => id === lastObjectId)?.source)
      .toBe("product");
    expect(store.getState().history).toHaveLength(6);
    expect(store.getState().history.at(-1)).toEqual(before);
    expect(store.getState().stateVersion).toBe(7);
    expect(events).toHaveLength(priorEvents + 1);
    expect(events.at(-1)).toEqual({
      cause: "replace",
      revision: before.revision + 1,
      scene: store.getState().scene,
    });
  });

  test("does not invoke placement for unsuccessful, non-replace, undo, or reset paths", () => {
    const proposePlacement = vi.fn(() => ({
      kind: "failed" as const,
      reason: "unexpected" as const,
    }));
    const store = createSceneStore(undefined, { proposePlacement });

    expect(store.getState().applyCommand({
      expectedRevision: 9,
      actor: "agent",
      command: { type: "replace", objectId: "table_01", product: sceneProductFor("coffee_table") },
    }).ok).toBe(false);
    expect(store.getState().applyCommand({
      expectedRevision: 1,
      actor: "agent",
      command: { type: "replace", objectId: "missing_01", product: sceneProductFor("coffee_table") },
    }).ok).toBe(false);
    expect(store.getState().applyCommand({
      expectedRevision: 1,
      actor: "agent",
      command: { type: "replace", objectId: "table_01", product: sceneProductFor("chair") },
    }).ok).toBe(false);
    expect(store.getState().applyCommand({
      expectedRevision: 1,
      actor: "human",
      command: { type: "preserve", objectId: "table_01", preserved: true },
    }).ok).toBe(true);
    expect(store.getState().applyCommand({
      expectedRevision: 2,
      actor: "agent",
      command: { type: "replace", objectId: "table_01", product: sceneProductFor("coffee_table") },
    }).ok).toBe(false);
    expect(store.getState().applyCommand({
      expectedRevision: 2,
      actor: "agent",
      command: { type: "move", objectId: "chair_01", position: { x: 1.5, z: 0.5 } },
    }).ok).toBe(true);
    expect(store.getState().undo()).toBe(true);
    store.getState().reset();

    expect(proposePlacement).not.toHaveBeenCalled();
  });

  test("clears placement notices on undo and reset without a second state-version increment", () => {
    const store = createSceneStore(completedProductScene(), {
      proposePlacement: () => ({
        kind: "unchanged",
        reason: "already-safe",
        diagnostics: { currentScore: 1, proposedScore: 1, evaluatedLayouts: 1 },
      }),
    });
    store.getState().arrangeNaturally();
    expect(store.getState().placementNotice).not.toBeNull();
    const beforeResetVersion = store.getState().stateVersion;
    store.getState().reset();
    expect(store.getState().placementNotice).toBeNull();
    expect(store.getState().stateVersion).toBe(beforeResetVersion + 1);

    const undoStore = createSceneStore(undefined, {
      proposePlacement: () => ({
        kind: "unchanged",
        reason: "already-safe",
        diagnostics: { currentScore: 1, proposedScore: 1, evaluatedLayouts: 1 },
      }),
    });
    const lastObjectId = completeFirstFive(undoStore);
    replaceDemoObject(undoStore, lastObjectId);
    expect(undoStore.getState().placementNotice).not.toBeNull();
    const beforeUndoVersion = undoStore.getState().stateVersion;
    expect(undoStore.getState().undo()).toBe(true);
    expect(undoStore.getState().placementNotice).toBeNull();
    expect(undoStore.getState().stateVersion).toBe(beforeUndoVersion + 1);
  });

  test("publishes a deep post-install snapshot and ignores observer exceptions", () => {
    const scene = completedProductScene();
    let installedDuringCallback: Scene | undefined;
    const store = createSceneStore(scene, {
      proposePlacement: completePlacementProposal,
      onCommit: (event) => {
        installedDuringCallback = structuredClone(store.getState().scene);
        event.scene.objects[0]!.position[0] = 999;
        throw new Error("renderer fault");
      },
    });

    const result = store.getState().arrangeNaturally();

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(installedDuringCallback).toEqual(store.getState().scene);
    expect(store.getState().scene.objects[0]!.position[0]).not.toBe(999);
  });
});
