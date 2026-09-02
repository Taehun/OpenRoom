import { describe, expect, it } from "vitest";

import { createDemoScene } from "../../src/demo/demo-scene";
import { hasCirculationPath } from "../../src/features/placement/circulation";
import { objectFootprint } from "../../src/features/placement/footprint-geometry";
import type { Footprint2D } from "../../src/features/placement/placement-types";

describe("placement circulation", () => {
  it("finds the demo opening from the foreground when only a rug crosses the route", () => {
    const scene = createDemoScene();
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    expect(hasCirculationPath(scene, [], [rug])).toBe(true);
  });

  it("keeps a rug traversable when it is supplied as an obstacle", () => {
    const scene = createDemoScene();
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    rug.position = [
      0,
      rug.position[1],
      scene.room.depth / 2 - rug.dimensionsM.depth / 2,
    ];

    expect(hasCirculationPath(scene, [objectFootprint(rug)], [rug])).toBe(true);
  });

  it("rejects a 0.75m route blocked across the room", () => {
    const scene = createDemoScene();
    const barrier: Footprint2D = {
      objectId: "barrier",
      center: { x: 0, z: 0 },
      halfWidth: 2.9,
      halfDepth: 0.45,
      rotationY: 0,
    };
    expect(hasCirculationPath(scene, [barrier], [])).toBe(false);
  });
});
