import type {
  DimensionsM,
  Scene,
  SceneObject,
} from "../scene/scene-schema";
import type { Footprint2D, OpeningClearanceZone, PointXZ } from "./placement-types";

const OPENING_SIDE_CLEARANCE_METRES = 0.2;
const OPENING_DEPTH_METRES = 0.75;

// Math.cos(0) and Math.sin(0) are exactly 1 and 0; skipping the call for the axis-aligned
// case (the overwhelming majority) keeps every result bit-for-bit the same.
function cosineOf(rotationY: number): number {
  return Object.is(rotationY, 0) ? 1 : Math.cos(rotationY);
}

function sineOf(rotationY: number): number {
  return Object.is(rotationY, 0) ? 0 : Math.sin(rotationY);
}

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
  const cosine = cosineOf(footprint.rotationY);
  const sine = sineOf(footprint.rotationY);
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

const BOUND_EPSILON = 1e-9;

/** Half-extent of a footprint's world-axis bounds, widened so it never under-covers. */
function worldBounds(footprint: Footprint2D, cosine: number, sine: number) {
  return {
    x:
      Math.abs(footprint.halfWidth * cosine) +
      Math.abs(footprint.halfDepth * sine) +
      BOUND_EPSILON,
    z:
      Math.abs(footprint.halfWidth * sine) +
      Math.abs(footprint.halfDepth * cosine) +
      BOUND_EPSILON,
  };
}

/**
 * Writes a footprint's four world corners into `out` as x/z pairs. Corner order and
 * arithmetic match `footprintCorners`; only the allocation is gone.
 */
function writeCorners(
  footprint: Footprint2D,
  cosine: number,
  sine: number,
  out: Float64Array,
): void {
  const { halfWidth, halfDepth } = footprint;
  const centerX = footprint.center.x;
  const centerZ = footprint.center.z;

  out[0] = centerX + -halfWidth * cosine - -halfDepth * sine;
  out[1] = centerZ + -halfWidth * sine + -halfDepth * cosine;
  out[2] = centerX + halfWidth * cosine - -halfDepth * sine;
  out[3] = centerZ + halfWidth * sine + -halfDepth * cosine;
  out[4] = centerX + halfWidth * cosine - halfDepth * sine;
  out[5] = centerZ + halfWidth * sine + halfDepth * cosine;
  out[6] = centerX + -halfWidth * cosine - halfDepth * sine;
  out[7] = centerZ + -halfWidth * sine + halfDepth * cosine;
}

// Corner scratch shared by the geometry predicates. None of them calls another, so a
// fixed pair of buffers removes an allocation per test without any aliasing.
const firstScratch = new Float64Array(8);
const secondScratch = new Float64Array(8);

function separatedOnAxis(
  first: Float64Array,
  second: Float64Array,
  axisX: number,
  axisZ: number,
): boolean {
  let firstMinimum = Number.POSITIVE_INFINITY;
  let firstMaximum = Number.NEGATIVE_INFINITY;
  let secondMinimum = Number.POSITIVE_INFINITY;
  let secondMaximum = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < 8; index += 2) {
    const firstValue = first[index]! * axisX + first[index + 1]! * axisZ;
    firstMinimum = Math.min(firstMinimum, firstValue);
    firstMaximum = Math.max(firstMaximum, firstValue);
    const secondValue = second[index]! * axisX + second[index + 1]! * axisZ;
    secondMinimum = Math.min(secondMinimum, secondValue);
    secondMaximum = Math.max(secondMaximum, secondValue);
  }

  return firstMaximum <= secondMinimum || secondMaximum <= firstMinimum;
}

export function footprintsOverlap(
  first: Footprint2D,
  second: Footprint2D,
): boolean {
  const firstCosine = cosineOf(first.rotationY);
  const firstSine = sineOf(first.rotationY);
  const secondCosine = cosineOf(second.rotationY);
  const secondSine = sineOf(second.rotationY);

  // Two rectangles whose world bounds are apart are separated on a tested axis too,
  // so this only skips work the exact test below would have rejected anyway.
  const firstBounds = worldBounds(first, firstCosine, firstSine);
  const secondBounds = worldBounds(second, secondCosine, secondSine);
  if (
    Math.abs(first.center.x - second.center.x) > firstBounds.x + secondBounds.x ||
    Math.abs(first.center.z - second.center.z) > firstBounds.z + secondBounds.z
  ) {
    return false;
  }

  const firstCorners = firstScratch;
  const secondCorners = secondScratch;
  writeCorners(first, firstCosine, firstSine, firstCorners);
  writeCorners(second, secondCosine, secondSine, secondCorners);

  return !(
    separatedOnAxis(firstCorners, secondCorners, firstCosine, firstSine) ||
    separatedOnAxis(firstCorners, secondCorners, -firstSine, firstCosine) ||
    separatedOnAxis(firstCorners, secondCorners, secondCosine, secondSine) ||
    separatedOnAxis(firstCorners, secondCorners, -secondSine, secondCosine)
  );
}

/**
 * Half-extents of a footprint's world-axis bounds. Two footprints whose centers are
 * further apart than the sum of their bounds on either axis cannot overlap.
 */
export function footprintBounds(footprint: Footprint2D): { x: number; z: number } {
  return worldBounds(
    footprint,
    cosineOf(footprint.rotationY),
    sineOf(footprint.rotationY),
  );
}

export interface FootprintExtent {
  minimumX: number;
  maximumX: number;
  minimumZ: number;
  maximumZ: number;
}

/** World-axis extent of a footprint's four corners, without materialising them. */
export function footprintExtent(footprint: Footprint2D): FootprintExtent {
  const cosine = cosineOf(footprint.rotationY);
  const sine = sineOf(footprint.rotationY);
  const corners = firstScratch;
  writeCorners(footprint, cosine, sine, corners);
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < 8; index += 2) {
    minimumX = Math.min(minimumX, corners[index]!);
    maximumX = Math.max(maximumX, corners[index]!);
    minimumZ = Math.min(minimumZ, corners[index + 1]!);
    maximumZ = Math.max(maximumZ, corners[index + 1]!);
  }

  return { minimumX, maximumX, minimumZ, maximumZ };
}

/** Span of a footprint's corners projected onto one axis. */
export function footprintProjection(
  footprint: Footprint2D,
  axisX: number,
  axisZ: number,
): { minimum: number; maximum: number } {
  const cosine = cosineOf(footprint.rotationY);
  const sine = sineOf(footprint.rotationY);
  const corners = firstScratch;
  writeCorners(footprint, cosine, sine, corners);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < 8; index += 2) {
    const value = corners[index]! * axisX + corners[index + 1]! * axisZ;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  return { minimum, maximum };
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
  const cosine = cosineOf(footprint.rotationY);
  const sine = sineOf(footprint.rotationY);
  const corners = firstScratch;
  writeCorners(footprint, cosine, sine, corners);

  for (let index = 0; index < 8; index += 2) {
    const x = corners[index]!;
    const z = corners[index + 1]!;
    if (x < minimumX || x > maximumX || z < minimumZ || z > maximumZ) return false;
  }

  return true;
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
