import { describe, expect, it } from "vitest";

import { hasCirculationPath } from "../../src/features/placement/circulation";
import {
  footprintInsideRoom,
  footprintsOverlap,
  objectFootprint,
  openingClearanceZones,
} from "../../src/features/placement/footprint-geometry";
import { proposeNaturalPlacement } from "../../src/features/placement/natural-placement";
import { PLACEMENT_LIMITS } from "../../src/features/placement/placement-profile";
import type { ProposedPlacement } from "../../src/features/placement/placement-types";
import type {
  Scene,
  SceneObject,
} from "../../src/features/scene/scene-schema";
import { completedProductScene } from "../helpers/natural-placement-fixtures";

function applyPlacements(
  scene: Scene,
  placements: readonly ProposedPlacement[],
): Scene {
  const next = structuredClone(scene);
  const byId = new Map(placements.map((placement) => [placement.objectId, placement]));

  for (const object of next.objects) {
    const placement = byId.get(object.id);
    if (!placement) continue;
    object.position = [...placement.position];
    object.rotation = [object.rotation[0], placement.rotationY, object.rotation[2]];
  }

  return next;
}

function pointInsideObjectFootprint(
  point: { x: number; z: number },
  object: SceneObject,
): boolean {
  const footprint = objectFootprint(object);
  const deltaX = point.x - footprint.center.x;
  const deltaZ = point.z - footprint.center.z;
  const cosine = Math.cos(footprint.rotationY);
  const sine = Math.sin(footprint.rotationY);
  const localX = deltaX * cosine + deltaZ * sine;
  const localZ = -deltaX * sine + deltaZ * cosine;
  return (
    Math.abs(localX) <= footprint.halfWidth &&
    Math.abs(localZ) <= footprint.halfDepth
  );
}

function keepObjects(scene: Scene, ...ids: string[]): Scene {
  const next = structuredClone(scene);
  next.objects = next.objects.filter(({ id }) => ids.includes(id));
  next.selectedObjectId = null;
  return next;
}

function thresholdScene(rugX: number): Scene {
  const scene = completedProductScene();
  const placements: readonly ProposedPlacement[] = [
    { objectId: "sofa_01", position: [-1.3, 0.36, -1.8], rotationY: 0 },
    { objectId: "rug_01", position: [rugX, 0.01, -0.6], rotationY: 0 },
    { objectId: "table_01", position: [-1.3, 0.2, -0.6], rotationY: 0 },
    {
      objectId: "chair_01",
      position: [-1.3, 0.38, 0.5],
      rotationY: Math.PI,
    },
    { objectId: "lamp_01", position: [1.8, 0.79, -2.1], rotationY: 0 },
    { objectId: "plant_01", position: [-2.4, 0.85, 0.3], rotationY: 0 },
  ];
  return applyPlacements(scene, placements);
}

describe("natural placement", () => {
  it("returns byte-equivalent proposals without mutating its Scene", () => {
    const scene = completedProductScene();
    const before = structuredClone(scene);
    const first = proposeNaturalPlacement(scene);
    const second = proposeNaturalPlacement(scene);
    expect(first).toEqual(second);
    expect(scene).toEqual(before);
    expect(first.kind).toBe("changed");
  });

  it("keeps locked objects exact and includes every movable known object", () => {
    const scene = completedProductScene();
    const locked = scene.objects.find(({ id }) => id === "sofa_01")!;
    locked.locked = true;
    const before = structuredClone(locked);
    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    expect(result.placements.some(({ objectId }) => objectId === locked.id)).toBe(false);
    expect(result.placements).toHaveLength(scene.objects.length - 1);
    expect(scene.objects.find(({ id }) => id === locked.id)).toEqual(before);
  });

  it("preserves the exact Y rotation of every non-rug cutout", () => {
    const scene = completedProductScene();
    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;

    for (const placement of result.placements) {
      const object = scene.objects.find(({ id }) => id === placement.objectId)!;
      if (object.type === "rug") continue;
      expect(placement.rotationY).toBe(object.rotation[1]);
    }
  });

  it("fails closed for an unlocked unknown object", () => {
    const scene = completedProductScene();
    scene.objects[0]!.type = "unknown";
    expect(proposeNaturalPlacement(scene)).toEqual({ kind: "failed", reason: "invalid-input" });
  });

  it("produces a safe relational layout that is unchanged on a second pass", () => {
    const scene = completedProductScene();
    const initialSofa = scene.objects.find(({ id }) => id === "sofa_01")!;
    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;

    const arranged = applyPlacements(scene, result.placements);
    const sofa = arranged.objects.find(({ id }) => id === "sofa_01")!;
    const table = arranged.objects.find(({ id }) => id === "table_01")!;
    const rug = arranged.objects.find(({ id }) => id === "rug_01")!;

    expect(Math.sign(sofa.position[0])).toBe(Math.sign(initialSofa.position[0]));
    const sofaTableEdgeGap =
      Math.abs(table.position[2] - sofa.position[2]) -
      sofa.dimensionsM.depth / 2 -
      table.dimensionsM.depth / 2;
    expect(sofaTableEdgeGap).toBeGreaterThanOrEqual(0.35);
    expect(sofaTableEdgeGap).toBeLessThanOrEqual(0.55);
    expect(
      pointInsideObjectFootprint({ x: table.position[0], z: table.position[2] }, rug),
    ).toBe(true);

    const nonRugs = arranged.objects.filter(({ type }) => type !== "rug");
    for (let first = 0; first < nonRugs.length; first += 1) {
      for (let second = first + 1; second < nonRugs.length; second += 1) {
        expect(
          footprintsOverlap(
            objectFootprint(nonRugs[first]!),
            objectFootprint(nonRugs[second]!),
          ),
        ).toBe(false);
      }
    }

    expect(
      hasCirculationPath(
        arranged,
        arranged.objects.map(objectFootprint),
        [rug],
      ),
    ).toBe(true);
    expect(proposeNaturalPlacement(arranged).kind).toBe("unchanged");
  });

  it("reaches a fixed point for a non-demo room arrangement", () => {
    const scene = completedProductScene();
    scene.id = "uploaded-wide-room";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [];
    const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
    sofa.position[0] = -1.6;
    sofa.position[2] = -1.2;
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    rug.position[0] = 0.7;
    rug.position[2] = -0.4;

    const first = proposeNaturalPlacement(scene);
    expect(first.kind).toBe("changed");
    if (first.kind !== "changed") return;
    const once = applyPlacements(scene, first.placements);

    expect(proposeNaturalPlacement(once).kind).toBe("unchanged");
  });

  it("uses a rotated sofa's local forward axis for the table and chair", () => {
    const scene = keepObjects(
      completedProductScene(),
      "sofa_01",
      "table_01",
      "chair_01",
    );
    scene.id = "rotated-seating";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [];
    const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
    const table = scene.objects.find(({ id }) => id === "table_01")!;
    const chair = scene.objects.find(({ id }) => id === "chair_01")!;
    sofa.position = [0, sofa.position[1], -0.5];
    sofa.rotation[1] = Math.PI / 2;
    sofa.locked = true;
    table.position = [0, table.position[1], -0.5];
    chair.position = [0, chair.position[1], 1.5];

    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    const arranged = applyPlacements(scene, result.placements);
    const arrangedTable = arranged.objects.find(({ id }) => id === "table_01")!;
    const arrangedChair = arranged.objects.find(({ id }) => id === "chair_01")!;
    const localForwardGap =
      Math.abs(arrangedTable.position[0] - sofa.position[0]) -
      sofa.dimensionsM.depth / 2 -
      arrangedTable.dimensionsM.width / 2;

    expect(arrangedTable.rotation[1]).toBe(table.rotation[1]);
    expect(localForwardGap).toBeGreaterThanOrEqual(0.35);
    expect(localForwardGap).toBeLessThanOrEqual(0.55);
    expect(Math.sign(arrangedTable.position[0] - sofa.position[0])).toBe(
      Math.sign(arrangedChair.position[0] - arrangedTable.position[0]),
    );
    expect(Math.abs(arrangedTable.position[2] - sofa.position[2])).toBeLessThanOrEqual(0.3);
    expect(Math.abs(arrangedChair.position[2] - arrangedTable.position[2])).toBeLessThanOrEqual(0.3);
  });

  it("rejects a locked accessory whose center is inside a locked rug seating zone", () => {
    const scene = keepObjects(completedProductScene(), "rug_01", "lamp_01");
    scene.id = "locked-seating-zone";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [];
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    const lamp = scene.objects.find(({ id }) => id === "lamp_01")!;
    rug.position = [0, rug.position[1], 0];
    rug.locked = true;
    lamp.position = [0.8, lamp.position[1], 0];
    lamp.locked = true;

    expect(proposeNaturalPlacement(scene)).toEqual({
      kind: "failed",
      reason: "no-valid-layout",
    });
  });

  it("moves an unlocked accessory outside a locked rug seating zone", () => {
    const scene = keepObjects(completedProductScene(), "rug_01", "lamp_01");
    scene.id = "movable-accessory-seating-zone";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [];
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    const lamp = scene.objects.find(({ id }) => id === "lamp_01")!;
    rug.position = [0, rug.position[1], 0];
    rug.locked = true;
    lamp.position = [0.8, lamp.position[1], 0];

    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    const arranged = applyPlacements(scene, result.placements);
    const arrangedLamp = arranged.objects.find(({ id }) => id === "lamp_01")!;
    expect(
      pointInsideObjectFootprint(
        { x: arrangedLamp.position[0], z: arrangedLamp.position[2] },
        rug,
      ),
    ).toBe(false);
  });

  it("reports an inconclusive truncated candidate search as exhausted", () => {
    const scene = keepObjects(completedProductScene(), "lamp_01");
    scene.id = "bounded-perimeter-search";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [
      {
        id: "back-window",
        kind: "window",
        wall: "back",
        offset: 0.5,
        widthM: 5,
        heightM: 1.2,
      },
      {
        id: "left-window",
        kind: "window",
        wall: "left",
        offset: 0.5,
        widthM: 5,
        heightM: 1.2,
      },
    ];
    const lamp = scene.objects[0]!;
    lamp.position = [-2.82, lamp.position[1], -2.82];

    const witness = structuredClone(scene);
    witness.objects[0]!.position = [2.7, lamp.position[1], 2.7];
    const witnessFootprint = objectFootprint(witness.objects[0]!);
    expect(footprintInsideRoom(witnessFootprint, witness.room, 0.1)).toBe(true);
    expect(
      openingClearanceZones(witness).some((zone) =>
        footprintsOverlap(witnessFootprint, zone),
      ),
    ).toBe(false);
    expect(hasCirculationPath(witness, [witnessFootprint], [])).toBe(true);
    expect(proposeNaturalPlacement(scene)).toEqual({
      kind: "failed",
      reason: "search-limit-exhausted",
    });
  });

  it("moves objects out of opening clearance zones", () => {
    const scene = keepObjects(completedProductScene(), "lamp_01");
    scene.id = "opening-clearance";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [
      {
        id: "back-window",
        kind: "window",
        wall: "back",
        offset: 0.5,
        widthM: 1,
        heightM: 1.2,
      },
    ];
    scene.objects[0]!.position = [0, scene.objects[0]!.position[1], -2.7];

    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    const arranged = applyPlacements(scene, result.placements);
    const footprint = objectFootprint(arranged.objects[0]!);
    expect(
      openingClearanceZones(arranged).some((zone) =>
        footprintsOverlap(footprint, zone),
      ),
    ).toBe(false);
  });

  it("fails closed when validated objects have duplicate IDs", () => {
    const scene = completedProductScene();
    scene.selectedObjectId = null;
    scene.objects[1]!.id = scene.objects[0]!.id;

    expect(proposeNaturalPlacement(scene)).toEqual({
      kind: "failed",
      reason: "invalid-input",
    });
  });

  it("keeps 99-or-lower improvements unchanged and accepts exactly 100", () => {
    expect(PLACEMENT_LIMITS.improvementThreshold).toBe(100);
    const below = proposeNaturalPlacement(thresholdScene(-0.3));
    expect(below.kind).toBe("unchanged");
    if (below.kind !== "unchanged") return;
    expect(below.diagnostics.currentScore).not.toBeNull();
    expect(below.diagnostics.proposedScore).not.toBeNull();
    expect(
      below.diagnostics.proposedScore! - below.diagnostics.currentScore!,
    ).toBeLessThan(PLACEMENT_LIMITS.improvementThreshold);

    const exact = proposeNaturalPlacement(thresholdScene(-0.25));
    expect(exact.kind).toBe("changed");
    if (exact.kind !== "changed") return;
    expect(exact.diagnostics.currentScore).not.toBeNull();
    expect(exact.diagnostics.proposedScore).not.toBeNull();
    expect(
      exact.diagnostics.proposedScore! - exact.diagnostics.currentScore!,
    ).toBe(PLACEMENT_LIMITS.improvementThreshold);
  });
});
