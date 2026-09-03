export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface PhotoCalibration {
  version: 1;
  backLeft: NormalizedPoint;
  backRight: NormalizedPoint;
  frontLeft: NormalizedPoint;
  frontRight: NormalizedPoint;
  backFloorY: number;
  frontFloorY: number;
  minScale: number;
  maxScale: number;
}

export const OPENROOM_PHOTO_CALIBRATION: Readonly<PhotoCalibration> = {
  version: 1,
  backLeft: { x: 0.24, y: 0.54 },
  backRight: { x: 0.76, y: 0.54 },
  frontLeft: { x: 0.04, y: 0.94 },
  frontRight: { x: 0.96, y: 0.94 },
  backFloorY: 0.54,
  frontFloorY: 0.94,
  minScale: 0.62,
  maxScale: 1.18,
};
