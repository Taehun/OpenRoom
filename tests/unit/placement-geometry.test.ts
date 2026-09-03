import { describe, expect, it } from "vitest";

import { createDemoScene } from "../../src/demo/demo-scene";
import {
  footprintInsideRoom,
  footprintsOverlap,
  objectFootprint,
  openingClearanceZones,
} from "../../src/features/placement/footprint-geometry";

describe("placement footprint geometry", () => {
  it("uses physical width/depth and Y rotation for overlap", () => {
    const scene = createDemoScene();
    const sofa = structuredClone(
      scene.objects.find(({ id }) => id === "sofa_01")!,
    );
    const table = structuredClone(
      scene.objects.find(({ id }) => id === "table_01")!,
    );
    sofa.position = [0, sofa.position[1], 0];
    table.position = [1.3, table.position[1], 0];
    expect(footprintsOverlap(objectFootprint(sofa), objectFootprint(table))).toBe(
      true,
    );
    table.position = [1.3, table.position[1], 1.2];
    table.rotation[1] = Math.PI / 2;
    expect(footprintsOverlap(objectFootprint(sofa), objectFootprint(table))).toBe(
      false,
    );
  });

  it("checks every rotated corner against the 0.1m inset", () => {
    const scene = createDemoScene();
    const chair = structuredClone(
      scene.objects.find(({ id }) => id === "chair_01")!,
    );
    chair.rotation[1] = Math.PI / 4;
    // A 45-degree square reaches half its diagonal past its centre, further than the
    // axis-aligned half width the centre clamp alone would allow.
    const reach =
      (chair.dimensionsM.width + chair.dimensionsM.depth) / 2 / Math.SQRT2;
    const limit = scene.room.width / 2 - 0.1 - reach;
    chair.position = [limit + 0.05, chair.position[1], 0];
    expect(footprintInsideRoom(objectFootprint(chair), scene.room, 0.1)).toBe(
      false,
    );
    chair.position = [limit - 0.05, chair.position[1], 0];
    expect(footprintInsideRoom(objectFootprint(chair), scene.room, 0.1)).toBe(
      true,
    );
  });

  it("maps normalized opening offsets to exact wall clearance zones", () => {
    const scene = createDemoScene();
    expect(openingClearanceZones(scene)).toEqual([
      expect.objectContaining({
        wall: "back",
        depthM: 0.75,
        widthM: expect.closeTo(1.8, 8),
      }),
    ]);
  });
});
