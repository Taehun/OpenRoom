import { describe, expect, test } from "vitest";

import { createDemoScene } from "../../src/demo/demo-scene";
import { hasCirculationPath } from "../../src/features/placement/circulation";
import {
  footprintCorners,
  footprintInsideRoom,
  footprintsOverlap,
  objectFootprint,
  openingClearanceZones,
} from "../../src/features/placement/footprint-geometry";
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
import {
  restingY,
  settleElevations,
  supportOf,
} from "../../src/features/scene/support";
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

const TABLE_LAMP_PRODUCT: SceneProduct = {
  id: "linen-drum-table-lamp",
  variantId: "demo-variant-linen-drum-table-lamp",
  title: "Linen Drum Table Lamp",
  category: "floor_lamp",
  price: { amountMinor: 8900, currency: "USD" },
  dimensionsCm: { width: 28, height: 46, depth: 28 },
  styleTags: ["japandi", "linen", "table-height"],
  color: "natural-flax",
  material: "linen-and-oak",
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
    expect(lamp.position[0]).toBeLessThanOrEqual(
      result.scene.room.width / 2 - 0.1 - lamp.dimensionsM.width / 2,
    );
    expect(lamp.position[2]).toBeGreaterThanOrEqual(
      -result.scene.room.depth / 2 + 0.1 + lamp.dimensionsM.depth / 2,
    );
    expect(lamp.rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(result.scene.revision).toBe(2);
  });

  test("moves an overlapping piece to the nearest open floor position", () => {
    const seed = createDemoScene();
    seed.objects = seed.objects.filter(({ id }) =>
      id === "sofa_01" || id === "chair_01"
    );
    seed.selectedObjectId = "chair_01";
    const scene = SceneSchema.parse(seed);
    const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;

    const result = applySceneCommand(scene, {
      expectedRevision: scene.revision,
      actor: "human",
      command: {
        type: "move",
        objectId: "chair_01",
        position: { x: sofa.position[0], z: sofa.position[2] },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const chair = result.scene.objects.find(({ id }) => id === "chair_01")!;
    expect(result.adjustedToFit).toBe(true);
    expect(
      footprintInsideRoom(objectFootprint(chair), result.scene.room, 0.1),
    ).toBe(true);
    expect(
      footprintsOverlap(objectFootprint(chair), objectFootprint(sofa)),
    ).toBe(false);
    // The side exits are blocked by the room boundary, so the nearest legal
    // resolution is directly in front of the sofa rather than through it.
    expect(chair.position[0]).toBeCloseTo(sofa.position[0], 9);
    expect(chair.position[2]).toBeGreaterThan(sofa.position[2]);
  });

  test("finds an open floor pocket when several pieces block the direct exits", () => {
    const scene = createDemoScene();
    const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;

    const result = applySceneCommand(scene, {
      expectedRevision: scene.revision,
      actor: "human",
      command: {
        type: "move",
        objectId: "chair_01",
        position: { x: sofa.position[0], z: sofa.position[2] },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const chair = result.scene.objects.find(({ id }) => id === "chair_01")!;
    expect(result.adjustedToFit).toBe(true);
    expect(
      footprintInsideRoom(objectFootprint(chair), result.scene.room, 0.1),
    ).toBe(true);
    for (const blocker of result.scene.objects) {
      if (blocker.id === chair.id || blocker.type === "rug") continue;
      expect(
        footprintsOverlap(objectFootprint(chair), objectFootprint(blocker)),
        `chair overlaps ${blocker.id}`,
      ).toBe(false);
    }
  });

  test("repositions a larger replacement inside the floor without overlap", () => {
    const seed = createDemoScene();
    seed.objects = seed.objects.filter(({ id }) =>
      id === "sofa_01" || id === "table_01"
    );
    seed.selectedObjectId = "table_01";
    const scene = SceneSchema.parse(seed);
    const originalTable = scene.objects.find(({ id }) => id === "table_01")!;
    const product: SceneProduct = {
      ...LIGHT_OAK_TABLE,
      id: "deep-oak-table",
      variantId: "demo-variant-deep-oak-table",
      title: "Deep Oak Table",
      dimensionsCm: { width: 120, height: 40, depth: 130 },
    };

    const result = applySceneCommand(scene, {
      expectedRevision: scene.revision,
      actor: "agent",
      command: {
        type: "replace",
        objectId: "table_01",
        product,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const table = result.scene.objects.find(({ id }) => id === "table_01")!;
    const sofa = result.scene.objects.find(({ id }) => id === "sofa_01")!;
    expect(result.adjustedToFit).toBe(true);
    expect(table.position[2]).toBeGreaterThan(originalTable.position[2]);
    expect(
      footprintInsideRoom(objectFootprint(table), result.scene.room, 0.1),
    ).toBe(true);
    expect(
      footprintsOverlap(objectFootprint(table), objectFootprint(sofa)),
    ).toBe(false);
  });

  test("rejects a replacement whose footprint cannot fit on the floor", () => {
    const scene = createDemoScene();
    const product: SceneProduct = {
      ...LIGHT_OAK_TABLE,
      id: "oversized-table",
      variantId: "demo-variant-oversized-table",
      title: "Oversized Table",
      dimensionsCm: { width: 400, height: 40, depth: 180 },
    };

    const result = applySceneCommand(scene, {
      expectedRevision: scene.revision,
      actor: "agent",
      command: {
        type: "replace",
        objectId: "table_01",
        product,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NO_VALID_PLACEMENT");
    expect(result.scene).toBe(scene);
    expect(result.scene.revision).toBe(1);
  });

  test("keeps every corner of a rotated footprint inside the room", () => {
    const seed = createDemoScene();
    seed.objects = seed.objects.filter(({ id }) => id === "sofa_01");
    seed.selectedObjectId = "sofa_01";
    const scene = SceneSchema.parse(seed);
    const rotated = applySceneCommand(scene, {
      expectedRevision: 1,
      actor: "human",
      command: {
        type: "move",
        objectId: "sofa_01",
        position: { x: 2.9, z: 2.3 },
        rotationYDegrees: 45,
      },
    });

    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    const sofa = rotated.scene.objects.find(({ id }) => id === "sofa_01")!;
    // The centre clamp alone would leave the 2.0 x 0.9 m sofa's diagonal corners
    // 0.6 m into the wall; the footprint clamp pulls the whole rectangle back.
    expect(rotated.adjustedToFit).toBe(true);
    expect(
      footprintInsideRoom(objectFootprint(sofa), rotated.scene.room, 0.1),
    ).toBe(true);
    for (const corner of footprintCorners(objectFootprint(sofa))) {
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(rotated.scene.room.width / 2 - 0.1);
      expect(Math.abs(corner.z)).toBeLessThanOrEqual(rotated.scene.room.depth / 2 - 0.1);
    }
    // Clamping never rejects: the sofa still moved toward the corner it was sent to.
    expect(sofa.position[0]).toBeGreaterThan(0);
    expect(sofa.position[2]).toBeGreaterThan(0);
  });

  // Important QA regression: every rotation step re-centred the turned bounding
  // box, so a piece walked across the floor as it turned and never walked back.
  test("keeps a turned piece where it stands while its corners stay on the floor", () => {
    const seed = createDemoScene();
    const chair = seed.objects.find(({ id }) => id === "chair_01")!;
    const before = [...chair.position];

    const turned = applySceneCommand(seed, {
      expectedRevision: 1,
      actor: "human",
      command: {
        type: "move",
        objectId: "chair_01",
        position: { x: chair.position[0], z: chair.position[2] },
        rotationYDegrees: 20,
      },
    });

    expect(turned.ok).toBe(true);
    if (!turned.ok) return;
    const after = turned.scene.objects.find(({ id }) => id === "chair_01")!;
    expect(after.position[0]).toBe(before[0]);
    expect(after.position[2]).toBe(before[2]);
    expect(after.rotation[1]).toBeCloseTo((20 * Math.PI) / 180);
    expect(turned.adjustedToFit).toBe(false);
  });

  test("turns in place when the command carries no position at all", () => {
    const seed = createDemoScene();
    const chair = seed.objects.find(({ id }) => id === "chair_01")!;
    const before = [...chair.position];

    const turned = applySceneCommand(seed, {
      expectedRevision: 1,
      actor: "agent",
      command: { type: "move", objectId: "chair_01", rotationYDegrees: -20 },
    });

    expect(turned.ok).toBe(true);
    if (!turned.ok) return;
    const after = turned.scene.objects.find(({ id }) => id === "chair_01")!;
    expect(after.position).toEqual(before);
    expect(after.rotation[1]).toBeCloseTo((-20 * Math.PI) / 180);
    expect(turned.adjustedToFit).toBe(false);
  });

  test("slides a turn by exactly the corner overshoot, not by re-centring", () => {
    const seed = createDemoScene();
    seed.objects = seed.objects.filter(({ id }) => id === "sofa_01");
    seed.selectedObjectId = "sofa_01";
    const scene = SceneSchema.parse(seed);
    const sofa = scene.objects[0]!;
    expect(sofa.position[2]).toBeCloseTo(-0.55, 12);

    const turned = applySceneCommand(scene, {
      expectedRevision: 1,
      actor: "human",
      command: {
        type: "move",
        objectId: "sofa_01",
        position: { x: sofa.position[0], z: sofa.position[2] },
        rotationYDegrees: 30,
      },
    });

    expect(turned.ok).toBe(true);
    if (!turned.ok) return;
    const after = turned.scene.objects.find(({ id }) => id === "sofa_01")!;
    // The 2 x 0.9 m sofa steps forward by exactly the corner overshoot, so its
    // back corner rests on the usable floor inset without re-centring the box.
    const radians = (30 * Math.PI) / 180;
    const halfExtentZ =
      Math.abs(Math.sin(radians)) * (after.dimensionsM.width / 2) +
      Math.abs(Math.cos(radians)) * (after.dimensionsM.depth / 2);
    expect(after.position[0]).toBe(sofa.position[0]);
    expect(after.position[2]).toBeCloseTo(
      -turned.scene.room.depth / 2 + 0.1 + halfExtentZ,
      12,
    );
    expect(after.position[2] - sofa.position[2]).toBeLessThan(0.2);
    expect(turned.adjustedToFit).toBe(true);
  });

  // A 2.4 x 1.7 m rug spans 2.9 m corner to corner at 45°, and the room is only
  // 2.72 m deep: no floor spot holds it, so the turn is refused outright rather
  // than half-applied with the rug climbing a wall.
  test("refuses a turn no floor spot can hold and names both angles", () => {
    const seed = createDemoScene();
    const held = applySceneCommand(seed, {
      expectedRevision: 1,
      actor: "human",
      command: {
        type: "move",
        objectId: "rug_01",
        position: { x: -0.2, z: 0.38 },
        rotationYDegrees: 15,
      },
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;

    const refused = applySceneCommand(held.scene, {
      expectedRevision: held.scene.revision,
      actor: "human",
      command: {
        type: "move",
        objectId: "rug_01",
        rotationYDegrees: 45,
      },
    });

    expect(refused.ok).toBe(true);
    if (!refused.ok) return;
    const heldRug = held.scene.objects.find(({ id }) => id === "rug_01")!;
    const rug = refused.scene.objects.find(({ id }) => id === "rug_01")!;
    expect(rug.rotation[1]).toBeCloseTo((15 * Math.PI) / 180, 12);
    expect(rug.position).toEqual(heldRug.position);
    expect(refused.adjustedToFit).toBe(true);
    expect(refused.message).toBe(
      "Rug kept at 15°: it does not fit the room at 45°.",
    );
  });

  test("rejects a move when the footprint is wider than the floor", () => {
    const seed = createDemoScene();
    const wide = structuredClone(seed);
    wide.objects.find(({ id }) => id === "sofa_01")!.dimensionsM = {
      width: 9,
      height: 0.85,
      depth: 0.9,
    };
    const scene = SceneSchema.parse(wide);
    const result = applySceneCommand(scene, {
      expectedRevision: 1,
      actor: "human",
      command: { type: "move", objectId: "sofa_01", position: { x: 2, z: 0 } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NO_VALID_PLACEMENT");
    expect(result.scene).toBe(scene);
  });

  test("raises a lamp onto the table it is moved over and drops it back off", () => {
    const seed = createDemoScene();
    const table = seed.objects.find(({ id }) => id === "table_01")!;
    const onto = applySceneCommand(seed, {
      expectedRevision: 1,
      actor: "agent",
      command: {
        type: "move",
        objectId: "lamp_01",
        position: { x: table.position[0], z: table.position[2] },
      },
    });

    expect(onto.ok).toBe(true);
    if (!onto.ok) return;
    const raised = onto.scene.objects.find(({ id }) => id === "lamp_01")!;
    expect(supportOf(onto.scene, raised)?.id).toBe("table_01");
    expect(raised.position[1]).toBeCloseTo(
      table.dimensionsM.height + raised.dimensionsM.height / 2,
      9,
    );
    // The reported position is the settled one, not the pre-settle request.
    expect(onto.appliedPosition).toEqual(raised.position);

    const away = applySceneCommand(onto.scene, {
      expectedRevision: 2,
      actor: "agent",
      command: { type: "move", objectId: "lamp_01", position: { x: -2.5, z: 2 } },
    });
    expect(away.ok).toBe(true);
    if (!away.ok) return;
    const lowered = away.scene.objects.find(({ id }) => id === "lamp_01")!;
    expect(supportOf(away.scene, lowered)).toBeNull();
    expect(lowered.position[1]).toBeCloseTo(lowered.dimensionsM.height / 2, 9);
  });

  test("settles a replacement onto the table the object already stands on", () => {
    const seed = createDemoScene();
    const table = seed.objects.find(({ id }) => id === "table_01")!;
    const moved = applySceneCommand(seed, {
      expectedRevision: 1,
      actor: "agent",
      command: {
        type: "move",
        objectId: "lamp_01",
        position: { x: table.position[0], z: table.position[2] },
      },
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    const replaced = applySceneCommand(moved.scene, {
      expectedRevision: 2,
      actor: "agent",
      command: {
        type: "replace",
        objectId: "lamp_01",
        product: TABLE_LAMP_PRODUCT,
      },
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    const lamp = replaced.scene.objects.find(({ id }) => id === "lamp_01")!;
    expect(lamp.position[1]).toBeCloseTo(0.42 + 0.46 / 2, 9);
    expect(replaced.appliedPosition).toEqual(lamp.position);
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
          const zone = openingClearanceZones(VALID_PLACEMENT_SCENE)[0]!;
          lamp.position[0] = zone.center.x;
          lamp.position[2] = zone.center.z;
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

describe("supportOf and restingY", () => {
  function lampAt(scene: Scene, x: number, z: number) {
    const lamp = scene.objects.find(({ id }) => id === "lamp_01")!;
    lamp.position = [x, lamp.position[1], z];
    return lamp;
  }

  test("supports a lamp whose centre is inside, on the edge of, or off the table", () => {
    const scene = createDemoScene();
    const table = scene.objects.find(({ id }) => id === "table_01")!;
    const [tableX, , tableZ] = table.position;
    const halfWidth = table.dimensionsM.width / 2;

    expect(supportOf(scene, lampAt(scene, tableX, tableZ))?.id).toBe("table_01");
    // Exactly on the edge counts as on the table.
    expect(supportOf(scene, lampAt(scene, tableX + halfWidth, tableZ))?.id).toBe(
      "table_01",
    );
    expect(
      supportOf(scene, lampAt(scene, tableX + halfWidth + 0.01, tableZ)),
    ).toBeNull();
  });

  test("respects the table's own rotation", () => {
    const scene = createDemoScene();
    const table = scene.objects.find(({ id }) => id === "table_01")!;
    table.rotation = [0, Math.PI / 2, 0];
    const [tableX, , tableZ] = table.position;
    // Turned a quarter turn, the 1.2 x 0.6 m table reaches 0.6 m along z, not x.
    expect(supportOf(scene, lampAt(scene, tableX, tableZ + 0.55))?.id).toBe(
      "table_01",
    );
    expect(supportOf(scene, lampAt(scene, tableX + 0.55, tableZ))).toBeNull();
  });

  test("never supports a non-lamp, and never lets a table support itself", () => {
    const scene = createDemoScene();
    const table = scene.objects.find(({ id }) => id === "table_01")!;
    const chair = scene.objects.find(({ id }) => id === "chair_01")!;
    chair.position = [table.position[0], chair.position[1], table.position[2]];

    expect(supportOf(scene, chair)).toBeNull();
    expect(supportOf(scene, table)).toBeNull();
  });

  test("rests objects on the floor, on a rug offset, or on a supporter", () => {
    const scene = createDemoScene();
    const lamp = scene.objects.find(({ id }) => id === "lamp_01")!;
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    const table = scene.objects.find(({ id }) => id === "table_01")!;

    expect(restingY(lamp, null)).toBe(lamp.dimensionsM.height / 2);
    expect(restingY(rug, null)).toBe(0.01);
    expect(restingY(lamp, table)).toBe(
      table.dimensionsM.height + lamp.dimensionsM.height / 2,
    );
  });

  test("settles every elevation in one pass and returns the Scene unchanged when nothing moves", () => {
    const scene = createDemoScene();
    expect(settleElevations(scene)).toBe(scene);

    const stacked = structuredClone(scene);
    const table = stacked.objects.find(({ id }) => id === "table_01")!;
    const lamp = stacked.objects.find(({ id }) => id === "lamp_01")!;
    lamp.position = [table.position[0], 0, table.position[2]];
    const settled = settleElevations(stacked);
    expect(settled).not.toBe(stacked);
    expect(
      settled.objects.find(({ id }) => id === "lamp_01")!.position[1],
    ).toBeCloseTo(table.dimensionsM.height + lamp.dimensionsM.height / 2, 9);
    // Nothing else moved.
    expect(
      settled.objects.filter(({ id }) => id !== "lamp_01"),
    ).toEqual(stacked.objects.filter(({ id }) => id !== "lamp_01"));
  });
});
