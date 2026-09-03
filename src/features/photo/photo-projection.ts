import type {
  ProductCategory,
  Scene,
  SceneObject,
  SceneObjectType,
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

const VISUAL_WIDTH_BOUNDS = {
  sofa: [14, 60],
  coffee_table: [7, 40],
  rug: [12, 70],
  floor_lamp: [4, 24],
  chair: [6, 38],
  plant: [6, 34],
  side_table: [5, 26],
  bookshelf: [8, 34],
  unknown: [6, 60],
} as const;

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
const LAYER_DEPTH_STRIDE = 1_000;
const PHOTO_STAGE_WIDTH_UNITS = 16;
const PHOTO_STAGE_HEIGHT_UNITS = 9;

export function objectVisualWidth(
  widthM: number,
  depthScale: number,
  type: SceneObjectType,
): number {
  const [minimum, maximum] = VISUAL_WIDTH_BOUNDS[type];
  return clamp(widthM * 18 * depthScale, minimum, maximum);
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
