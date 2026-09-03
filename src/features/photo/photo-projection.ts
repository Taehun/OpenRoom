import type {
  ProductCategory,
  Scene,
  SceneObject,
} from "../scene/scene-schema";
import {
  footprintCorners,
  objectFootprint,
} from "../placement/footprint-geometry";
import type { PointXZ } from "../placement/placement-types";
import type { NormalizedQuad, PhotoAsset } from "./photo-assets";
import {
  OPENROOM_PHOTO_CALIBRATION,
  type NormalizedPoint,
  type PhotoCalibration,
} from "./photo-calibration";
import {
  isValidFloorQuad,
  projectiveTransformCss,
  solveProjectiveTransform,
  type PixelPoint,
  type ProjectiveTransform,
} from "./projective-transform";

type SceneRoom = Pick<Scene["room"], "width" | "depth">;

export interface ProjectedPlacement extends NormalizedPoint {
  left: number;
  top: number;
  scale: number;
  zIndex: number;
}

export interface StageSize {
  width: number;
  height: number;
}

export interface RugProjection {
  sourcePixels: readonly [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
  destinationPixels: readonly [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
  destinationNormalized: NormalizedQuad;
  transform: ProjectiveTransform;
  cssTransform: string;
}

export interface ContactShadowProjection {
  left: number;
  top: number;
  width: number;
  height: number;
  rotationDegrees: number;
  blurPx: number;
  opacity: number;
  zIndex: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;

export function projectRoomPoint(
  position: { x: number; z: number },
  room: SceneRoom,
  calibration: PhotoCalibration = OPENROOM_PHOTO_CALIBRATION,
): ProjectedPlacement {
  const depth = clamp((position.z + room.depth / 2) / room.depth, 0, 1);
  const horizontal = clamp((position.x + room.width / 2) / room.width, 0, 1);
  const floorLeft = lerp(calibration.backLeft.x, calibration.frontLeft.x, depth);
  const floorRight = lerp(
    calibration.backRight.x,
    calibration.frontRight.x,
    depth,
  );
  const left = lerp(floorLeft, floorRight, horizontal);
  const top = lerp(calibration.backFloorY, calibration.frontFloorY, depth);

  return {
    x: left,
    y: top,
    left,
    top,
    scale: lerp(calibration.minScale, calibration.maxScale, depth),
    zIndex: Math.round(depth * 1000),
  };
}

export function unprojectStagePoint(
  point: NormalizedPoint,
  room: SceneRoom,
  calibration: PhotoCalibration = OPENROOM_PHOTO_CALIBRATION,
): { x: number; z: number } {
  const stageX = clamp(point.x, 0, 1);
  const stageY = clamp(point.y, 0, 1);
  const depth = clamp(
    (stageY - calibration.backFloorY) /
      (calibration.frontFloorY - calibration.backFloorY),
    0,
    1,
  );
  const floorLeft = lerp(calibration.backLeft.x, calibration.frontLeft.x, depth);
  const floorRight = lerp(
    calibration.backRight.x,
    calibration.frontRight.x,
    depth,
  );
  const horizontal = clamp((stageX - floorLeft) / (floorRight - floorLeft), 0, 1);

  return {
    x: lerp(-room.width / 2, room.width / 2, horizontal),
    z: lerp(-room.depth / 2, room.depth / 2, depth),
  };
}

function pointIsInsideRoom(point: PointXZ, room: SceneRoom) {
  return (
    point.x >= -room.width / 2 &&
    point.x <= room.width / 2 &&
    point.z >= -room.depth / 2 &&
    point.z <= room.depth / 2
  );
}

export function projectRugPlacement(
  object: SceneObject,
  asset: PhotoAsset,
  room: SceneRoom,
  stage: StageSize,
): RugProjection | null {
  if (
    object.type !== "rug" ||
    !asset.floorQuad ||
    !isValidFloorQuad(asset.floorQuad) ||
    !Number.isFinite(stage.width) ||
    !Number.isFinite(stage.height) ||
    stage.width <= 0 ||
    stage.height <= 0 ||
    !Number.isFinite(room.width) ||
    !Number.isFinite(room.depth) ||
    room.width <= 0 ||
    room.depth <= 0 ||
    !Number.isFinite(object.position[0]) ||
    !Number.isFinite(object.position[2]) ||
    !Number.isFinite(object.rotation[1]) ||
    !Number.isFinite(object.dimensionsM.width) ||
    !Number.isFinite(object.dimensionsM.depth) ||
    object.dimensionsM.width <= 0 ||
    object.dimensionsM.depth <= 0 ||
    !Number.isFinite(asset.intrinsicWidth) ||
    !Number.isFinite(asset.intrinsicHeight) ||
    asset.intrinsicWidth <= 0 ||
    asset.intrinsicHeight <= 0
  ) {
    return null;
  }

  const corners = footprintCorners(objectFootprint(object));
  if (!corners.every((corner) => pointIsInsideRoom(corner, room))) return null;

  const destinationNormalized = corners.map(({ x, z }) => {
    const projected = projectRoomPoint({ x, z }, room);
    return { x: projected.x, y: projected.y };
  }) as [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];
  const sourcePixels = asset.floorQuad.map(({ x, y }) => ({
    x: x * asset.intrinsicWidth,
    y: y * asset.intrinsicHeight,
  })) as [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
  const destinationPixels = destinationNormalized.map(({ x, y }) => ({
    x: x * stage.width,
    y: y * stage.height,
  })) as [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
  const transform = solveProjectiveTransform(sourcePixels, destinationPixels);
  if (!transform) return null;

  return {
    sourcePixels,
    destinationPixels,
    destinationNormalized,
    transform,
    cssTransform: projectiveTransformCss(transform),
  };
}

const CONTACT_SHADOW_PROFILES = {
  sofa: { widthFactor: 0.72, depthFactor: 0.35, opacity: 0.22 },
  coffee_table: { widthFactor: 0.75, depthFactor: 0.55, opacity: 0.2 },
  floor_lamp: { widthFactor: 0.45, depthFactor: 0.45, opacity: 0.18 },
  chair: { widthFactor: 0.65, depthFactor: 0.5, opacity: 0.2 },
  plant: { widthFactor: 0.55, depthFactor: 0.5, opacity: 0.19 },
  side_table: { widthFactor: 0.6, depthFactor: 0.5, opacity: 0.19 },
  bookshelf: { widthFactor: 0.8, depthFactor: 0.35, opacity: 0.2 },
  unknown: { widthFactor: 0.6, depthFactor: 0.45, opacity: 0.18 },
} as const;

const RUG_LAYER_BASE = 0;
const SHADOW_LAYER_BASE = 2_000_000;
const VERTICAL_LAYER_BASE = 4_000_000;
export const LAYER_DEPTH_STRIDE = 1_000;
/** One global sanity floor, so a fallback label stays readable. */
const MINIMUM_VISUAL_WIDTH_PERCENT = 1.5;
/** A rug lies on the floor rather than standing on it (`room-engine.floorY`). */
const RUG_RESTING_HEIGHT_M = 0.01;
const ELEVATION_EPSILON_M = 1e-6;
const PHOTO_STAGE_WIDTH_UNITS = 16;
const PHOTO_STAGE_HEIGHT_UNITS = 9;

/** Where a Z metre lies between the back wall (0) and the front of the room (1). */
export function floorDepthFraction(z: number, room: SceneRoom): number {
  return clamp((z + room.depth / 2) / room.depth, 0, 1);
}

/**
 * The calibrated floor's width in stage units at one depth: 0.52 at the back wall,
 * 0.92 at the front. The whole room spans it, so it is the scale of everything
 * standing there.
 */
export function floorWidthAt(
  depth: number,
  calibration: PhotoCalibration = OPENROOM_PHOTO_CALIBRATION,
): number {
  const amount = clamp(depth, 0, 1);
  return (
    lerp(calibration.backRight.x, calibration.frontRight.x, amount) -
    lerp(calibration.backLeft.x, calibration.frontLeft.x, amount)
  );
}

/**
 * Stage units per metre of height at one depth. The photo's perspective is
 * approximated as uniform at a depth, so a metre up the wall covers as much stage as a
 * metre across the floor and a cutout keeps its real aspect ratio.
 */
export function verticalScaleAt(
  depth: number,
  room: SceneRoom,
  calibration: PhotoCalibration = OPENROOM_PHOTO_CALIBRATION,
): number {
  if (!Number.isFinite(room.width) || room.width <= 0) return 0;
  return floorWidthAt(depth, calibration) / room.width;
}

/**
 * The projected lateral extent of an object's oriented footprint, as a percentage of
 * the stage width: its real width scaled by the floor where it stands, with no
 * per-category multiplier or clamp. A rotated footprint is wider than its own width
 * because its corners reach further sideways. Every corner is projected at the
 * object's own depth, the same depth `verticalScaleAt` uses, so the cutout is scaled
 * once and stays square with the room.
 */
export function objectVisualWidth(
  object: SceneObject,
  room: SceneRoom,
  calibration: PhotoCalibration = OPENROOM_PHOTO_CALIBRATION,
): number {
  const z = object.position[2];
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  for (const corner of footprintCorners(objectFootprint(object))) {
    const projected = projectRoomPoint({ x: corner.x, z }, room, calibration);
    minimum = Math.min(minimum, projected.x);
    maximum = Math.max(maximum, projected.x);
  }

  const width = (maximum - minimum) * 100;
  return Number.isFinite(width)
    ? Math.max(width, MINIMUM_VISUAL_WIDTH_PERCENT)
    : MINIMUM_VISUAL_WIDTH_PERCENT;
}

/** Where an object's centre sits when it stands on the floor. */
export function objectRestingHeight(object: SceneObject): number {
  return object.type === "rug"
    ? RUG_RESTING_HEIGHT_M
    : object.dimensionsM.height / 2;
}

/** How far above the floor an object stands, in metres; 0 when it rests on it. */
export function objectElevation(object: SceneObject): number {
  const elevation = object.position[1] - objectRestingHeight(object);
  return Number.isFinite(elevation) && elevation > ELEVATION_EPSILON_M
    ? elevation
    : 0;
}

/**
 * How far up the stage a raised object is drawn, in stage units. Only the cutout and
 * the floor chrome that rides with it move: the contact shadow keeps using the
 * footprint, so a lamp on a table still casts its shadow on the table's floor patch.
 */
export function objectElevationOffset(
  object: SceneObject,
  room: SceneRoom,
  calibration: PhotoCalibration = OPENROOM_PHOTO_CALIBRATION,
): number {
  const elevation = objectElevation(object);
  if (elevation === 0) return 0;
  return (
    elevation *
    verticalScaleAt(
      floorDepthFraction(object.position[2], room),
      room,
      calibration,
    )
  );
}

export function projectContactShadow(
  object: SceneObject,
  room: SceneRoom,
): ContactShadowProjection {
  const placement = projectRoomPoint(
    { x: object.position[0], z: object.position[2] },
    room,
  );
  const projectedCorners = footprintCorners(objectFootprint(object)).map(
    ({ x, z }) => projectRoomPoint({ x, z }, room),
  );
  const midpoint = (
    first: ProjectedPlacement,
    second: ProjectedPlacement,
  ) => ({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });
  const widthStart = midpoint(projectedCorners[0], projectedCorners[3]);
  const widthEnd = midpoint(projectedCorners[1], projectedCorners[2]);
  const depthStart = midpoint(projectedCorners[0], projectedCorners[1]);
  const depthEnd = midpoint(projectedCorners[3], projectedCorners[2]);
  const widthAxis = {
    x: (widthEnd.x - widthStart.x) * PHOTO_STAGE_WIDTH_UNITS,
    y: (widthEnd.y - widthStart.y) * PHOTO_STAGE_HEIGHT_UNITS,
  };
  const depthAxis = {
    x: (depthEnd.x - depthStart.x) * PHOTO_STAGE_WIDTH_UNITS,
    y: (depthEnd.y - depthStart.y) * PHOTO_STAGE_HEIGHT_UNITS,
  };

  const profile =
    object.type === "rug"
      ? CONTACT_SHADOW_PROFILES.unknown
      : CONTACT_SHADOW_PROFILES[object.type];
  const scaleRange =
    OPENROOM_PHOTO_CALIBRATION.maxScale -
    OPENROOM_PHOTO_CALIBRATION.minScale;
  const depthAmount =
    scaleRange === 0
      ? 0
      : clamp(
          (placement.scale - OPENROOM_PHOTO_CALIBRATION.minScale) / scaleRange,
          0,
          1,
        );

  return {
    // The cutout is a billboard anchored at the projected footprint centre, so the
    // shadow is centred there too. The mean of the projected corners is not that point:
    // the floor projection is bilinear, and its cross term pulls the mean sideways for
    // any rotation that is not a multiple of a quarter turn, sliding the shadow out from
    // under the object it grounds.
    left: placement.left,
    top: placement.top,
    width:
      (Math.hypot(widthAxis.x, widthAxis.y) / PHOTO_STAGE_WIDTH_UNITS) *
      100 *
      profile.widthFactor,
    height:
      (Math.hypot(depthAxis.x, depthAxis.y) / PHOTO_STAGE_HEIGHT_UNITS) *
      100 *
      profile.depthFactor,
    rotationDegrees:
      (Math.atan2(widthAxis.y, widthAxis.x) * 180) / Math.PI,
    blurPx: lerp(4, 10, depthAmount),
    opacity: clamp(profile.opacity * placement.scale, 0, 0.28),
    zIndex: SHADOW_LAYER_BASE + placement.zIndex * LAYER_DEPTH_STRIDE,
  };
}

export function stableLayerOrder(
  object: SceneObject,
  placement: ProjectedPlacement,
  lexicalIndex: number,
): number {
  const layerBase =
    object.type === "rug" ? RUG_LAYER_BASE : VERTICAL_LAYER_BASE;
  return (
    layerBase +
    placement.zIndex * LAYER_DEPTH_STRIDE +
    Math.max(0, Math.trunc(lexicalIndex))
  );
}

export function layerOrder(type: ProductCategory, zIndex: number): number {
  return type === "rug" ? zIndex - 100 : zIndex;
}
