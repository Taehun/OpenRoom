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
  NOOK_PHOTO_CALIBRATION,
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

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;

export function projectRoomPoint(
  position: { x: number; z: number },
  room: SceneRoom,
  calibration: PhotoCalibration = NOOK_PHOTO_CALIBRATION,
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
  calibration: PhotoCalibration = NOOK_PHOTO_CALIBRATION,
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
  sofa: [24, 52],
  coffee_table: [10, 36],
  rug: [20, 56],
  floor_lamp: [6, 20],
  chair: [10, 32],
  plant: [8, 26],
  unknown: [8, 56],
} as const;

export function objectVisualWidth(
  widthM: number,
  depthScale: number,
  type: SceneObjectType,
): number {
  const [minimum, maximum] = VISUAL_WIDTH_BOUNDS[type];
  return clamp(widthM * 18 * depthScale, minimum, maximum);
}

export function layerOrder(type: ProductCategory, zIndex: number): number {
  return type === "rug" ? zIndex - 100 : zIndex;
}
