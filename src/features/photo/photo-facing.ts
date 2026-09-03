/**
 * Facing vectors in the room XZ frame: `x` grows to the viewer's right and `z`
 * grows toward the camera, so `forward(0) = { x: 0, z: 1 }` faces the camera
 * side. `rotation[1]` stays the only stored orientation; facing is derived.
 */
export interface FacingVector {
  x: number;
  z: number;
}

export type PhotoViewName = "front-quarter" | "side" | "back-quarter" | "back";

export const PHOTO_VIEW_NAMES: readonly PhotoViewName[] = [
  "front-quarter",
  "side",
  "back-quarter",
  "back",
];

/** Every photographed cutout is turned 35° to the viewer's right. */
const QUARTER_TURN = (35 * Math.PI) / 180;

/** The direction each canonical view's front points in the image frame. */
export const FRONT_VECTORS: Readonly<Record<PhotoViewName, FacingVector>> =
  Object.freeze({
    "front-quarter": { x: Math.sin(QUARTER_TURN), z: Math.cos(QUARTER_TURN) },
    side: { x: 1, z: 0 },
    "back-quarter": { x: Math.sin(QUARTER_TURN), z: -Math.cos(QUARTER_TURN) },
    back: { x: 0, z: -1 },
  });

export function facingOf(rotationY: number): FacingVector {
  return { x: -Math.sin(rotationY), z: Math.cos(rotationY) };
}

/** Inverse of `facingOf`, normalised into (-π, π]. */
export function rotationYOf(facing: FacingVector): number {
  const yaw = Math.atan2(-facing.x, facing.z);
  return yaw <= -Math.PI ? yaw + Math.PI * 2 : yaw;
}

/** Null for a zero-length or non-finite vector; a unit vector otherwise. */
export function normalizeFacing(v: {
  x: number;
  z: number;
}): FacingVector | null {
  if (!Number.isFinite(v.x) || !Number.isFinite(v.z)) return null;
  const length = Math.hypot(v.x, v.z);
  if (length < 1e-6) return null;
  return { x: v.x / length, z: v.z / length };
}

/** Angle between two unit vectors, 0..180 degrees. */
export function angleBetweenDegrees(a: FacingVector, b: FacingVector): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z));
  return (Math.acos(dot) * 180) / Math.PI;
}

export function roundFacing(f: FacingVector): FacingVector {
  const round = (n: number) => Math.round(n * 10_000) / 10_000 || 0;
  return { x: round(f.x), z: round(f.z) };
}
