import { describe, expect, it } from "vitest";
import { DEMO_ROOM_WIDTH_M, createDemoScene } from "../../src/demo/demo-scene";
import {
  entryZonePoints,
  occupiesEntryZone,
} from "../../src/features/placement/circulation";
import {
  footprintInsideRoom,
  footprintsOverlap,
  objectFootprint,
  openingClearanceZones,
} from "../../src/features/placement/footprint-geometry";
import {
  getPhotoAssetSet,
  selectPhotoView,
} from "../../src/features/photo/photo-views";
import { objectVisualWidth } from "../../src/features/photo/photo-projection";
import type { Scene } from "../../src/features/scene/scene-schema";

const ROOM_INSET_M = 0.1;

function objectById(scene: Scene, id: string) {
  const object = scene.objects.find((candidate) => candidate.id === id);
  if (!object) throw new Error(`Missing seed object ${id}`);
  return object;
}

// The demo room is calibrated from the before photo: the dated sofa's silhouette spans
// 0.4575 of the stage, the curtained window bay 0.225 and the club chair 0.209, and the
// widths those imply overlap at 3.4 m. The seed places the photographed pieces where
// they stand in the photo, at true scale, inside that room.
describe("calibrated demo scene", () => {
  it("builds the 3.4 x 2.72 m photo room with its back-wall window", () => {
    const scene = createDemoScene();

    expect(DEMO_ROOM_WIDTH_M).toBe(3.4);
    expect(scene.room.width).toBe(3.4);
    expect(scene.room.depth).toBeCloseTo(2.72, 10);
    expect(scene.room.height).toBe(2.5);
    expect(scene.openings).toEqual([
      expect.objectContaining({
        id: "window_01",
        kind: "window",
        wall: "back",
        offset: 0.62,
        widthM: 1.4,
      }),
    ]);
    expect(scene.id).toBe("demo-living-room");
    expect(scene.source).toBe("demo");
    expect(scene.selectedObjectId).toBe("table_01");
  });

  it("seeds the six photographed pieces at their calibrated spots", () => {
    const scene = createDemoScene();
    const placements = Object.fromEntries(
      scene.objects.map((object) => [
        object.id,
        [object.position[0], object.position[2], object.rotation[1]],
      ]),
    );

    expect(placements).toEqual({
      sofa_01: [-0.2, -0.55, 0],
      table_01: [-0.225, 0.6, 0],
      rug_01: [0, 0.38, 0],
      lamp_01: [-1.425, -0.1, 0],
      chair_01: [1.03, 0.55, Math.PI / 4],
      plant_01: [1.2, -0.3, 0],
    });
    expect(scene.objects.map(({ assetId }) => assetId)).toEqual([
      "seed-dated-sofa",
      "seed-glass-table",
      "seed-pattern-rug",
      "seed-brass-lamp",
      "seed-vinyl-chair",
      "seed-faux-plant",
    ]);
  });

  it("rests every piece on the floor at its category height", () => {
    const scene = createDemoScene();
    for (const object of scene.objects) {
      const restingY =
        object.type === "rug" ? 0.01 : object.dimensionsM.height / 2;
      expect(object.position[1]).toBe(restingY);
      expect(object.rotation[0]).toBe(0);
      expect(object.rotation[2]).toBe(0);
    }
  });

  it("keeps every footprint inside the 0.1 m inset", () => {
    const scene = createDemoScene();
    for (const object of scene.objects) {
      expect(
        footprintInsideRoom(objectFootprint(object), scene.room, ROOM_INSET_M),
        `${object.id} inside the inset`,
      ).toBe(true);
    }
  });

  it("lets only the rug overlap another footprint", () => {
    const scene = createDemoScene();
    const overlapping: string[] = [];
    for (const [index, first] of scene.objects.entries()) {
      for (const second of scene.objects.slice(index + 1)) {
        if (footprintsOverlap(objectFootprint(first), objectFootprint(second))) {
          overlapping.push(`${first.id}+${second.id}`);
        }
      }
    }

    // Only the rug may overlap: it lies under the sofa's front, the table, the
    // chair's near corner, and the lamp's foot.
    expect(overlapping.length).toBeGreaterThan(0);
    for (const pair of overlapping) expect(pair, pair).toContain("rug_01");
  });

  it("keeps everything but the wall-length sofa out of the window clearance", () => {
    const scene = createDemoScene();
    const [zone] = openingClearanceZones(scene);
    expect(zone).toBeDefined();
    const blocking = scene.objects
      .filter((object) => footprintsOverlap(objectFootprint(object), zone!))
      .map(({ id }) => id);

    // A 2 m sofa on a 3.4 m wall cannot clear a 1.8 m window zone; it stands under
    // the window as the photographed sofa does. The plant stands just in front of it.
    expect(blocking).toEqual(["sofa_01"]);
    const plant = objectById(scene, "plant_01");
    expect(plant.position[2] - plant.dimensionsM.depth / 2).toBeGreaterThan(
      zone!.center.z + zone!.halfDepth,
    );
  });

  // The solver's full circulation rule (a 0.75 m route from the entry to the window
  // clearance) cannot hold here: the photographed sofa stands under the window of a
  // 3.4 m room, so only the walk-in entry itself is asserted.
  it("keeps the foreground entry free to walk into", () => {
    const scene = createDemoScene();
    const obstacles = scene.objects
      .filter(({ type }) => type !== "rug")
      .map(objectFootprint);
    const entry = entryZonePoints(scene);
    expect(entry.length).toBeGreaterThan(0);
    expect(occupiesEntryZone(entry, obstacles)).toBe(false);
  });

  it("faces the sofa and table at the camera on their native cutouts and turns the chair to the table", () => {
    const scene = createDemoScene();
    const sofa = objectById(scene, "sofa_01");
    const table = objectById(scene, "table_01");
    const chair = objectById(scene, "chair_01");

    // Left of centre at yaw 0 the compositor keeps the photographed front-quarter view.
    expect(sofa.position[0]).toBeLessThanOrEqual(0);
    const sofaView = selectPhotoView(sofa, getPhotoAssetSet(sofa)!);
    expect(sofaView).toMatchObject({ mirrored: false, exact: true });
    expect(sofaView.view.view).toBe("front-quarter");
    const tableView = selectPhotoView(table, getPhotoAssetSet(table)!);
    expect(tableView).toMatchObject({ mirrored: false, exact: true });

    // Right of the table and turned 45 degrees toward it, the chair's mirrored cutout
    // is within coverage.
    expect(chair.position[0]).toBeGreaterThan(table.position[0]);
    const chairView = selectPhotoView(chair, getPhotoAssetSet(chair)!);
    expect(chairView).toMatchObject({ mirrored: true, exact: true });
    expect(chairView.angleDegrees).toBeCloseTo(10, 6);
  });

  it("draws the sofa at roughly a third of the stage, as photographed", () => {
    const scene = createDemoScene();
    const sofa = objectById(scene, "sofa_01");
    const chair = objectById(scene, "chair_01");

    // The photographed sofa spans 0.4575 of the stage at its hem; the 2 m footprint
    // box at the seed depth covers 35% (the front-quarter silhouette fills its box, so
    // the drawn width is a little under scale), and the 6 m room drew it at 25%.
    expect(objectVisualWidth(sofa, scene.room)).toBeGreaterThan(32);
    expect(objectVisualWidth(sofa, scene.room)).toBeLessThan(40);
    expect(objectVisualWidth(chair, scene.room)).toBeGreaterThan(25);
  });

  it("keeps the analysis anchors for the roomier fixture width", () => {
    const scene = createDemoScene({ widthM: 6 });

    expect(scene.room).toEqual({ width: 6, height: 2.5, depth: 4.8 });
    expect(objectById(scene, "sofa_01").position).toEqual([-1.9, 0.425, 0]);
    expect(objectById(scene, "table_01").position).toEqual([0, 0.21, 0]);
    expect(objectById(scene, "lamp_01").position[0]).toBe(0.5);
    expect(objectById(scene, "chair_01").rotation[1]).toBe(0);
  });
});
