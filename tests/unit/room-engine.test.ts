import { describe, expect, test } from "vitest";

import { buildScene } from "../../src/features/room/room-engine";
import type { SceneObject } from "../../src/features/scene/scene-schema";

function isInsideRoomByPointOneMetres(
  object: SceneObject,
  room: { width: number; depth: number },
) {
  const halfWidth = object.dimensionsM.width / 2;
  const halfDepth = object.dimensionsM.depth / 2;

  return (
    object.position[0] - halfWidth >= -room.width / 2 + 0.1 - 1e-9 &&
    object.position[0] + halfWidth <= room.width / 2 - 0.1 + 1e-9 &&
    object.position[2] - halfDepth >= -room.depth / 2 + 0.1 - 1e-9 &&
    object.position[2] + halfDepth <= room.depth / 2 - 0.1 + 1e-9
  );
}

function aabbOverlaps(first: SceneObject, second: SceneObject) {
  const xDistance = Math.abs(first.position[0] - second.position[0]);
  const zDistance = Math.abs(first.position[2] - second.position[2]);

  return (
    xDistance <
      (first.dimensionsM.width + second.dimensionsM.width) / 2 &&
    zDistance <
      (first.dimensionsM.depth + second.dimensionsM.depth) / 2
  );
}

describe("buildScene", () => {
  test("builds a deterministic bounded room and omits low-confidence objects", () => {
    const scene = buildScene(
      {
        roomType: "living_room",
        estimatedAspectRatio: 1.5,
        openings: [{ kind: "window", wall: "back", offset: 0.62 }],
        objects: [
          { type: "sofa", anchor: "left-wall", confidence: 0.91 },
          { type: "coffee_table", anchor: "center", confidence: 0.86 },
          { type: "plant", anchor: "back-right", confidence: 0.54 },
        ],
      },
      6,
    );

    expect(scene.room).toEqual({ width: 6, height: 2.5, depth: 4 });
    expect(scene.revision).toBe(1);
    expect(scene.objects.map((object) => object.type)).toEqual([
      "sofa",
      "coffee_table",
    ]);
    expect(
      scene.objects.every((object) =>
        isInsideRoomByPointOneMetres(object, scene.room),
      ),
    ).toBe(true);
    expect(aabbOverlaps(scene.objects[0], scene.objects[1])).toBe(false);
  });

  test("clamps extreme room dimensions and rests every object on the floor", () => {
    const scene = buildScene(
      {
        roomType: "living_room",
        estimatedAspectRatio: 0.1,
        openings: [],
        objects: [
          { type: "sofa", anchor: "left-wall", confidence: 0.9 },
          { type: "rug", anchor: "center", confidence: 0.9 },
          { type: "floor_lamp", anchor: "back-right", confidence: 0.9 },
        ],
      },
      20,
    );

    expect(scene.room).toEqual({ width: 8, height: 2.5, depth: 8 });
    expect(
      scene.objects.every((object) =>
        isInsideRoomByPointOneMetres(object, scene.room),
      ),
    ).toBe(true);
    expect(
      scene.objects.every((object) =>
        object.type === "rug"
          ? object.position[1] === 0.01
          : object.position[1] === object.dimensionsM.height / 2,
      ),
    ).toBe(true);
  });
});
