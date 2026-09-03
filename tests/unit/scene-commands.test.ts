import { describe, expect, test } from "vitest";

import { createDemoScene } from "../../src/demo/demo-scene";
import { hasCirculationPath } from "../../src/features/placement/circulation";
import { objectFootprint } from "../../src/features/placement/footprint-geometry";
import { proposeNaturalPlacement } from "../../src/features/placement/natural-placement";
import type {
  NaturalPlacementResult,
  ProposedPlacement,
} from "../../src/features/placement/placement-types";
import { validateAndApplyPlacement } from "../../src/features/scene/natural-placement-command";
import { applySceneCommand } from "../../src/features/scene/scene-commands";
import {
  SceneSchema,
  type Scene,
  type SceneProduct,
} from "../../src/features/scene/scene-schema";
import { completedProductScene } from "../helpers/natural-placement-fixtures";

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

function changedProposal(scene: Scene) {
  const result = proposeNaturalPlacement(scene);
  if (result.kind !== "changed") {
    throw new Error(`Expected a changed proposal, received ${result.kind}`);
  }
  return result;
}

const VALID_PLACEMENT_SCENE = completedProductScene();
const VALID_PLACEMENT_PROPOSAL = changedProposal(VALID_PLACEMENT_SCENE);

function validPlacementFixture() {
  return {
    scene: structuredClone(VALID_PLACEMENT_SCENE),
    proposal: structuredClone(VALID_PLACEMENT_PROPOSAL),
  };
}

function withPlacements(
  proposal: Extract<NaturalPlacementResult, { kind: "changed" }>,
  update: (placements: ProposedPlacement[]) => void,
) {
  const next = {
    ...structuredClone(proposal),
    placements: proposal.placements.map((placement) =>
      structuredClone(placement),
    ),
  };
  update(next.placements);
  return next;
}

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
    expect(table.assetId).toBe("oak-frame-table");
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

describe("validateAndApplyPlacement", () => {
  test("applies one complete proposal without mutating the input or its revision", () => {
    const { scene, proposal } = validPlacementFixture();
    const before = structuredClone(scene);

    const result = validateAndApplyPlacement(scene, proposal);

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(result.scene.revision).toBe(scene.revision);
    expect(result.scene).not.toBe(scene);
    expect(scene).toEqual(before);
    if (!result.ok || !result.changed) return;
    for (const placement of proposal.placements) {
      const object = result.scene.objects.find(({ id }) => id === placement.objectId)!;
      expect(object.position).toEqual(placement.position);
      expect(object.rotation[1]).toBe(placement.rotationY);
    }
  });

  test("passes unchanged and failed solver outcomes through without changing the Scene", () => {
    const scene = completedProductScene();
    const unchanged = validateAndApplyPlacement(scene, {
      kind: "unchanged",
      reason: "already-safe",
      diagnostics: { currentScore: 10, proposedScore: 10, evaluatedLayouts: 1 },
    });
    const failed = validateAndApplyPlacement(scene, {
      kind: "failed",
      reason: "search-limit-exhausted",
    });

    expect(unchanged).toEqual({ ok: true, changed: false, scene });
    expect(failed).toEqual({
      ok: false,
      scene,
      reason: "search-limit-exhausted",
    });
  });

  test.each([
    [
      "a missing unlocked object",
      (proposal: ReturnType<typeof changedProposal>) =>
        withPlacements(proposal, (placements) => placements.pop()),
    ],
    [
      "a duplicate object id",
      (proposal: ReturnType<typeof changedProposal>) =>
        withPlacements(proposal, (placements) => {
          placements[1]!.objectId = placements[0]!.objectId;
        }),
    ],
    [
      "an unknown object id",
      (proposal: ReturnType<typeof changedProposal>) =>
        withPlacements(proposal, (placements) => {
          placements[0]!.objectId = "missing_01";
        }),
    ],
    [
      "a non-finite coordinate",
      (proposal: ReturnType<typeof changedProposal>) =>
        withPlacements(proposal, (placements) => {
          placements[0]!.position[0] = Number.NaN;
        }),
    ],
    [
      "a changed vertical coordinate",
      (proposal: ReturnType<typeof changedProposal>) =>
        withPlacements(proposal, (placements) => {
          placements[0]!.position[1] += 0.01;
        }),
    ],
    [
      "a changed vertical-cutout rotation",
      (proposal: ReturnType<typeof changedProposal>) =>
        withPlacements(proposal, (placements) => {
          const sofa = placements.find(({ objectId }) => objectId === "sofa_01")!;
          sofa.rotationY += 0.1;
        }),
    ],
    [
      "an out-of-room footprint",
      (proposal: ReturnType<typeof changedProposal>) =>
        withPlacements(proposal, (placements) => {
          placements[0]!.position[0] = 99;
        }),
    ],
    [
      "overlapping non-rug footprints",
      (proposal: ReturnType<typeof changedProposal>) =>
        withPlacements(proposal, (placements) => {
          const sofa = placements.find(({ objectId }) => objectId === "sofa_01")!;
          const table = placements.find(({ objectId }) => objectId === "table_01")!;
          table.position[0] = sofa.position[0];
          table.position[2] = sofa.position[2];
        }),
    ],
    [
      "an opening obstruction",
      (proposal: ReturnType<typeof changedProposal>) =>
        withPlacements(proposal, (placements) => {
          const lamp = placements.find(({ objectId }) => objectId === "lamp_01")!;
          lamp.position[0] = 0.72;
          lamp.position[2] = -2.7;
        }),
    ],
  ])("rejects %s atomically", (_name, mutate) => {
    const { scene, proposal } = validPlacementFixture();
    const before = structuredClone(scene);
    const result = validateAndApplyPlacement(scene, mutate(proposal));

    expect(result).toEqual({ ok: false, scene, reason: "invalid-input" });
    expect(scene).toEqual(before);
  });

  test("rejects placements for locked and unlocked unknown objects", () => {
    const { scene: lockedScene, proposal } = validPlacementFixture();
    lockedScene.objects.find(({ id }) => id === proposal.placements[0]!.objectId)!.locked = true;
    expect(validateAndApplyPlacement(lockedScene, proposal)).toEqual({
      ok: false,
      scene: lockedScene,
      reason: "invalid-input",
    });

    const { scene: unknownScene } = validPlacementFixture();
    unknownScene.objects[0]!.type = "unknown";
    const unknownProposal = structuredClone(proposal);
    expect(validateAndApplyPlacement(unknownScene, unknownProposal)).toEqual({
      ok: false,
      scene: unknownScene,
      reason: "invalid-input",
    });
  });

  test("rejects a collision-free proposal that severs room circulation", () => {
    const scene = completedProductScene();
    scene.id = "blocked-circulation";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [
      {
        id: "front-door",
        kind: "door",
        wall: "front",
        offset: 0.5,
        widthM: 1,
        heightM: 2,
      },
      {
        id: "back-window",
        kind: "window",
        wall: "back",
        offset: 0.5,
        widthM: 1,
        heightM: 1.2,
      },
    ];
    scene.objects = [scene.objects.find(({ id }) => id === "sofa_01")!];
    scene.selectedObjectId = null;
    scene.objects[0]!.dimensionsM = { width: 5.2, height: 0.72, depth: 0.8 };
    scene.objects[0]!.position = [0, scene.objects[0]!.position[1], 0.1];
    const parsed = SceneSchema.parse(scene);
    const proposal: NaturalPlacementResult = {
      kind: "changed",
      placements: [{
        objectId: "sofa_01",
        position: [0, parsed.objects[0]!.position[1], 0],
        rotationY: parsed.objects[0]!.rotation[1],
      }],
      diagnostics: { currentScore: null, proposedScore: 1, evaluatedLayouts: 1 },
    };
    const proposedScene = structuredClone(parsed);
    proposedScene.objects[0]!.position = [...proposal.placements[0]!.position];
    expect(
      hasCirculationPath(
        proposedScene,
        proposedScene.objects.map(objectFootprint),
        [],
      ),
    ).toBe(false);

    expect(validateAndApplyPlacement(parsed, proposal)).toEqual({
      ok: false,
      scene: parsed,
      reason: "invalid-input",
    });
  });
});
