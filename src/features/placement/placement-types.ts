import type { Scene, Vec3 } from "../scene/scene-schema";

export const PLACEMENT_PROFILE_VERSION = 1 as const;

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
