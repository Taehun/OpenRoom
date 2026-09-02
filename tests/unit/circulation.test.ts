import { describe, expect, it } from "vitest";

import { createDemoScene } from "../../src/demo/demo-scene";
import {
  entryZonePoints,
  hasCirculationPath,
  occupiesEntryZone,
} from "../../src/features/placement/circulation";
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

  it("reports the foreground entry zone as occupied when furniture covers it", () => {
    const scene = createDemoScene();
    const blocker: Footprint2D = {
      objectId: "lamp_01",
      center: { x: 0.2, z: 2 },
      halfWidth: 0.29,
      halfDepth: 0.29,
      rotationY: 0,
    };

    expect(entryZonePoints(scene).length).toBeGreaterThan(0);
    expect(occupiesEntryZone(entryZonePoints(scene), [blocker])).toBe(true);
    expect(hasCirculationPath(scene, [blocker], [])).toBe(false);
  });

  it("keeps the foreground entry zone usable when furniture only clips its edge", () => {
    const scene = createDemoScene();
    const clipper: Footprint2D = {
      objectId: "lamp_01",
      center: { x: 1, z: 2 },
      halfWidth: 0.29,
      halfDepth: 0.29,
      rotationY: 0,
    };

    expect(occupiesEntryZone(entryZonePoints(scene), [clipper])).toBe(false);
    expect(hasCirculationPath(scene, [clipper], [])).toBe(true);
  });
});
