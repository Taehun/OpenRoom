import type {
  DimensionsM,
  Scene,
  SceneObject,
} from "../scene/scene-schema";
import type { Footprint2D, OpeningClearanceZone, PointXZ } from "./placement-types";

const OPENING_SIDE_CLEARANCE_METRES = 0.2;
const OPENING_DEPTH_METRES = 0.75;

export function objectFootprint(object: SceneObject): Footprint2D {
  return {
    objectId: object.id,
    center: { x: object.position[0], z: object.position[2] },
    halfWidth: object.dimensionsM.width / 2,
    halfDepth: object.dimensionsM.depth / 2,
    rotationY: object.rotation[1],
  };
}

export function footprintCorners(
  footprint: Footprint2D,
): readonly [PointXZ, PointXZ, PointXZ, PointXZ] {
  const cosine = Math.cos(footprint.rotationY);
  const sine = Math.sin(footprint.rotationY);
  const localCorners: readonly [PointXZ, PointXZ, PointXZ, PointXZ] = [
    { x: -footprint.halfWidth, z: -footprint.halfDepth },
    { x: footprint.halfWidth, z: -footprint.halfDepth },
    { x: footprint.halfWidth, z: footprint.halfDepth },
    { x: -footprint.halfWidth, z: footprint.halfDepth },
  ];

  return localCorners.map(({ x, z }) => ({
    x: footprint.center.x + x * cosine - z * sine,
    z: footprint.center.z + x * sine + z * cosine,
  })) as [PointXZ, PointXZ, PointXZ, PointXZ];
}

function axesFor(footprint: Footprint2D): readonly [PointXZ, PointXZ] {
  const cosine = Math.cos(footprint.rotationY);
  const sine = Math.sin(footprint.rotationY);
  return [
    { x: cosine, z: sine },
    { x: -sine, z: cosine },
  ];
}

function projection(corners: readonly PointXZ[], axis: PointXZ) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    const value = corner.x * axis.x + corner.z * axis.z;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  return { minimum, maximum };
}

export function footprintsOverlap(
  first: Footprint2D,
  second: Footprint2D,
): boolean {
  const firstCorners = footprintCorners(first);
  const secondCorners = footprintCorners(second);

  for (const axis of [...axesFor(first), ...axesFor(second)]) {
    const firstProjection = projection(firstCorners, axis);
    const secondProjection = projection(secondCorners, axis);
    if (
      firstProjection.maximum <= secondProjection.minimum ||
      secondProjection.maximum <= firstProjection.minimum
    ) {
      return false;
    }
  }

  return true;
}

export function footprintInsideRoom(
  footprint: Footprint2D,
  room: DimensionsM,
  insetM = 0,
): boolean {
  const minimumX = -room.width / 2 + insetM;
  const maximumX = room.width / 2 - insetM;
  const minimumZ = -room.depth / 2 + insetM;
  const maximumZ = room.depth / 2 - insetM;

  return footprintCorners(footprint).every(
    ({ x, z }) =>
      x >= minimumX && x <= maximumX && z >= minimumZ && z <= maximumZ,
  );
}

export function openingClearanceZones(
  scene: Scene,
): readonly OpeningClearanceZone[] {
  return scene.openings.map((opening) => {
    const widthM = opening.widthM + OPENING_SIDE_CLEARANCE_METRES * 2;
    const halfDepth = OPENING_DEPTH_METRES / 2;

    switch (opening.wall) {
      case "front":
        return {
          objectId: opening.id,
          wall: opening.wall,
          widthM,
          depthM: OPENING_DEPTH_METRES,
          center: {
            x: -scene.room.width / 2 + opening.offset * scene.room.width,
            z: scene.room.depth / 2 - halfDepth,
          },
          halfWidth: widthM / 2,
          halfDepth,
          rotationY: 0,
        };
      case "back":
        return {
          objectId: opening.id,
          wall: opening.wall,
          widthM,
          depthM: OPENING_DEPTH_METRES,
          center: {
            x: -scene.room.width / 2 + opening.offset * scene.room.width,
            z: -scene.room.depth / 2 + halfDepth,
          },
          halfWidth: widthM / 2,
          halfDepth,
          rotationY: 0,
        };
      case "left":
        return {
          objectId: opening.id,
          wall: opening.wall,
          widthM,
          depthM: OPENING_DEPTH_METRES,
          center: {
            x: -scene.room.width / 2 + halfDepth,
            z: -scene.room.depth / 2 + opening.offset * scene.room.depth,
          },
          halfWidth: widthM / 2,
          halfDepth,
          rotationY: Math.PI / 2,
        };
      case "right":
        return {
          objectId: opening.id,
          wall: opening.wall,
          widthM,
          depthM: OPENING_DEPTH_METRES,
          center: {
            x: scene.room.width / 2 - halfDepth,
            z: -scene.room.depth / 2 + opening.offset * scene.room.depth,
          },
          halfWidth: widthM / 2,
          halfDepth,
          rotationY: Math.PI / 2,
        };
    }
  });
}
