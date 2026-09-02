import { describe, expect, it } from "vitest";

import { hasCirculationPath } from "../../src/features/placement/circulation";
import {
  footprintsOverlap,
  objectFootprint,
} from "../../src/features/placement/footprint-geometry";
import { proposeNaturalPlacement } from "../../src/features/placement/natural-placement";
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
});
