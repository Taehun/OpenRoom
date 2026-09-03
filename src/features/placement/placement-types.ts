import type { Scene, Vec3 } from "../scene/scene-schema";

export const PLACEMENT_PROFILE_VERSION = 2 as const;

export interface PointXZ {
  x: number;
  z: number;
}

export interface Footprint2D {
  objectId: string;
  center: PointXZ;
  halfWidth: number;
  halfDepth: number;
  rotationY: number;
}

export interface OpeningClearanceZone extends Footprint2D {
  wall: Scene["openings"][number]["wall"];
  widthM: number;
  depthM: 0.75;
}

/**
 * One orientation the solver may propose for an object, with how truthfully a
 * registered photo view can show it (0 < fidelity <= 1). Built from the photo
 * view registry; `placement` never imports from `photo`.
 */
export interface RotationOption {
  rotationY: number;
  fidelity: number;
}

/**
 * What the caller knows about the orientations each object can be shown in. An object
 * with no entry keeps the rotation it came with, at fidelity 1, which is the behaviour
 * of every caller that passes nothing. Rugs ignore the table (spec 8.1).
 */
export interface PlacementOptions {
  rotationOptions?: Readonly<Record<string, readonly RotationOption[]>>;
}

export interface ProposedPlacement {
  objectId: string;
  position: Vec3;
  rotationY: number;
}

export interface PlacementDiagnostics {
  currentScore: number | null;
  proposedScore: number | null;
  evaluatedLayouts: number;
}

export type PlacementFailureReason =
  | "invalid-input"
  | "no-valid-layout"
  | "search-limit-exhausted"
  | "unexpected";

export type NaturalPlacementResult =
  | {
      kind: "changed";
      placements: readonly ProposedPlacement[];
      diagnostics: PlacementDiagnostics;
    }
  | {
      kind: "unchanged";
      reason: "already-safe" | "no-safe-improvement";
      diagnostics: PlacementDiagnostics;
    }
  | { kind: "failed"; reason: PlacementFailureReason };
