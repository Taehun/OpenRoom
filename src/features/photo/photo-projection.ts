import type { ProductCategory, Scene } from "../scene/scene-schema";
import {
  NOOK_PHOTO_CALIBRATION,
  type NormalizedPoint,
  type PhotoCalibration,
} from "./photo-calibration";

type SceneRoom = Pick<Scene["room"], "width" | "depth">;

export interface ProjectedPlacement extends NormalizedPoint {
  left: number;
  top: number;
  scale: number;
  zIndex: number;
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

export function objectVisualWidth(widthM: number, scale: number): number {
  return clamp(widthM * scale * 100, 8, 58);
}

export function layerOrder(type: ProductCategory, zIndex: number): number {
  return type === "rug" ? zIndex - 100 : zIndex;
}
