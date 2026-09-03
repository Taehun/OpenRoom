import { z } from "zod";
import { DEMO_PRODUCTS } from "../demo/demo-data";
import type { RotationOption } from "../placement/placement-types";
import type {
  Scene,
  SceneObject,
  SceneObjectType,
} from "../scene/scene-schema";
import {
  PHOTO_ASSETS,
  type NormalizedQuad,
  type PhotoAsset,
} from "./photo-assets";
import type { CutoutContentBox } from "./photo-assets";
import {
  FRONT_VECTORS,
  PHOTO_VIEW_NAMES,
  angleBetweenDegrees,
  facingOf,
  rotationYOf,
  type FacingVector,
  type PhotoViewName,
} from "./photo-facing";
import { GENERATED_VIEW_MANIFEST as manifest } from "./photo-views.generated";
import { CUTOUT_SILHOUETTES } from "./photo-silhouettes.generated";

export type { RotationOption };

export type PhotoViewOrigin = "photographed" | "generated";
export type PhotoViewSymmetry = "none" | "front-back" | "radial";

export interface PhotoAssetView {
  /** Measured alpha box of this view's image; absent for unmeasured images. */
  contentBox?: CutoutContentBox;
  view: PhotoViewName;
  frontVector: FacingVector;
  src: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  anchorX: number;
  anchorY: number;
  origin: PhotoViewOrigin;
}

export interface PhotoAssetSet {
  id: string;
  type: SceneObjectType;
  symmetry: PhotoViewSymmetry;
  /** The photographed front-quarter view first, then generated views. */
  views: readonly PhotoAssetView[];
  floorQuad?: NormalizedQuad;
}

/**
 * `front-back` means a facing and its opposite are shown by the same image;
 * `radial` means one image serves every facing (rugs never use views).
 */
export const PHOTO_VIEW_SYMMETRY: Readonly<
  Record<SceneObjectType, PhotoViewSymmetry>
> = Object.freeze({
  sofa: "none",
  chair: "none",
  coffee_table: "front-back",
  floor_lamp: "radial",
  plant: "radial",
  rug: "radial",
  side_table: "radial",
  bookshelf: "front-back",
  unknown: "none",
});

const SEED_ASSET_TYPES: Record<string, SceneObjectType> = {
  "seed-dated-sofa": "sofa",
  "seed-glass-table": "coffee_table",
  "seed-pattern-rug": "rug",
  "seed-brass-lamp": "floor_lamp",
  "seed-vinyl-chair": "chair",
  "seed-faux-plant": "plant",
};

export const PHOTO_ASSET_TYPES: Readonly<Record<string, SceneObjectType>> =
  Object.freeze({
    ...SEED_ASSET_TYPES,
    ...Object.fromEntries(
      DEMO_PRODUCTS.map((product) => [product.id, product.category]),
    ),
  });

/** A view covers every facing within this angle, and is exact within it. */
const COVERAGE_DEGREES = 45;
const ORIGIN_WEIGHT: Readonly<Record<PhotoViewOrigin, number>> = Object.freeze({
  photographed: 1,
  generated: 0.8,
});
const MIRROR_WEIGHT = 0.95;
/** Angles closer than this count as a tie and fall through to preferences. */
const TIE_DEGREES = 1e-7;
/** Facings this close to the camera axis keep the room-centre choice of twin. */
const STRAIGHT_ON_DEGREES = 22.5;
/** Wide enough for the native and mirrored front-quarter twins (2 × 35°). */
const STRAIGHT_ON_TIE_DEGREES = 71;
const ROTATION_STEP = Math.PI / 4;
const ROTATION_EPSILON = 1e-9;
/** Keeps an uncovered incumbent rotation scoreable but never preferred. */
const INCUMBENT_FIDELITY = 0.01;

export interface GeneratedViewEntry {
  assetId: string;
  view: Exclude<PhotoViewName, "front-quarter">;
  src: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  anchorX: number;
  anchorY: number;
  /** Provenance only; never reaches the compositor. */
  model: string;
  generatedAt: string;
}

export interface GeneratedViewManifest {
  version: 1;
  views: GeneratedViewEntry[];
}

export const GeneratedViewManifestSchema = z
  .object({
    version: z.literal(1),
    views: z.array(
      z
        .object({
          assetId: z.string().min(1),
          view: z.enum(["side", "back-quarter", "back"]),
          src: z.string().startsWith("/demo/photo/"),
          intrinsicWidth: z.number().int().positive(),
          intrinsicHeight: z.number().int().positive(),
          anchorX: z.number().min(0).max(1),
          anchorY: z.number().min(0).max(1),
          model: z.string().min(1),
          generatedAt: z.iso.datetime(),
        })
        .strict(),
    ),
  })
  .strict() satisfies z.ZodType<GeneratedViewManifest>;

function photographedView(asset: PhotoAsset): PhotoAssetView {
  return {
    view: "front-quarter",
    frontVector: FRONT_VECTORS["front-quarter"],
    src: asset.src,
    intrinsicWidth: asset.intrinsicWidth,
    intrinsicHeight: asset.intrinsicHeight,
    anchorX: asset.anchorX,
    anchorY: asset.anchorY,
    origin: "photographed",
    ...(asset.contentBox ? { contentBox: asset.contentBox } : {}),
  };
}

export function buildPhotoAssetSets(
  base: Record<string, PhotoAsset>,
  types: Record<string, SceneObjectType>,
  manifest: GeneratedViewManifest,
): Record<string, PhotoAssetSet> {
  const parsed = GeneratedViewManifestSchema.parse(manifest);
  const generated = new Map<string, PhotoAssetView[]>();

  for (const entry of parsed.views) {
    if (!base[entry.assetId]) {
      throw new Error(`photo-views manifest: unknown asset ${entry.assetId}`);
    }
    const views = generated.get(entry.assetId) ?? [];
    if (views.some((view) => view.view === entry.view)) {
      throw new Error(
        `photo-views manifest: duplicate view ${entry.assetId}/${entry.view}`,
      );
    }
    views.push({
      view: entry.view,
      frontVector: FRONT_VECTORS[entry.view],
      src: entry.src,
      intrinsicWidth: entry.intrinsicWidth,
      intrinsicHeight: entry.intrinsicHeight,
      anchorX: entry.anchorX,
      anchorY: entry.anchorY,
      origin: "generated",
      ...(() => {
        const key = entry.src.replace(/^.*\//, "").replace(/\.webp$/, "");
        const contentBox = CUTOUT_SILHOUETTES[key];
        return contentBox ? { contentBox } : {};
      })(),
    });
    generated.set(entry.assetId, views);
  }

  const sets: Record<string, PhotoAssetSet> = {};
  for (const [id, asset] of Object.entries(base)) {
    const type = types[id] ?? "unknown";
    const views = (generated.get(id) ?? []).sort(
      (first, second) =>
        PHOTO_VIEW_NAMES.indexOf(first.view) -
        PHOTO_VIEW_NAMES.indexOf(second.view),
    );
    sets[id] = {
      id,
      type,
      symmetry: PHOTO_VIEW_SYMMETRY[type],
      views: [photographedView(asset), ...views],
      ...(asset.floorQuad ? { floorQuad: asset.floorQuad } : {}),
    };
  }
  return sets;
}

export const PHOTO_ASSET_SETS: Readonly<Record<string, PhotoAssetSet>> =
  Object.freeze(
    buildPhotoAssetSets(
      PHOTO_ASSETS,
      PHOTO_ASSET_TYPES,
      GeneratedViewManifestSchema.parse(manifest),
    ),
  );

export function getPhotoAssetSet(
  object: Pick<SceneObject, "assetId">,
): PhotoAssetSet | null {
  return object.assetId ? PHOTO_ASSET_SETS[object.assetId] ?? null : null;
}

export interface SelectedPhotoView {
  view: PhotoAssetView;
  mirrored: boolean;
  /** The candidate's front vector after mirroring. */
  frontVector: FacingVector;
  /** The candidate's anchor after mirroring. */
  anchorX: number;
  angleDegrees: number;
  exact: boolean;
}

interface ViewCandidate {
  view: PhotoAssetView;
  mirrored: boolean;
  frontVector: FacingVector;
  anchorX: number;
  order: number;
}

/**
 * Consults both sides on purpose: the object type keeps a rug or lamp from ever
 * being turned even when it carries a mismatched `assetId`, and the set keeps a
 * radial image from being mirrored. `viewFidelity` stays set-only because Task
 * 4 scores bare facings against a set, with no object in hand.
 */
function isRadial(type: SceneObjectType, set: PhotoAssetSet | null): boolean {
  return PHOTO_VIEW_SYMMETRY[type] === "radial" || set?.symmetry === "radial";
}

/** Every view as-is plus, when mirroring is truthful, its left/right twin. */
function candidatesFor(set: PhotoAssetSet): ViewCandidate[] {
  const candidates: ViewCandidate[] = [];
  for (const view of set.views) {
    candidates.push({
      view,
      mirrored: false,
      frontVector: view.frontVector,
      anchorX: view.anchorX,
      order: candidates.length,
    });
    if (set.symmetry !== "radial") {
      candidates.push({
        view,
        mirrored: true,
        frontVector: { x: -view.frontVector.x, z: view.frontVector.z },
        anchorX: 1 - view.anchorX,
        order: candidates.length,
      });
    }
  }
  return candidates;
}

function candidateAngleDegrees(
  candidate: ViewCandidate,
  facing: FacingVector,
  symmetry: PhotoViewSymmetry,
): number {
  const direct = angleBetweenDegrees(facing, candidate.frontVector);
  if (symmetry !== "front-back") return direct;
  const reversed = angleBetweenDegrees(
    { x: -facing.x, z: -facing.z },
    candidate.frontVector,
  );
  return Math.min(direct, reversed);
}

type TieRank = [number, number, number, number];

function tieRank(candidate: ViewCandidate, preferPositiveX: boolean): TieRank {
  const facesRoomCentre = preferPositiveX
    ? candidate.frontVector.x > 0
    : candidate.frontVector.x <= 0;
  return [
    facesRoomCentre ? 0 : 1,
    candidate.view.origin === "photographed" ? 0 : 1,
    candidate.mirrored ? 1 : 0,
    candidate.order,
  ];
}

function compareTieRanks(first: TieRank, second: TieRank): number {
  return (
    first[0] - second[0] ||
    first[1] - second[1] ||
    first[2] - second[2] ||
    first[3] - second[3]
  );
}

export function selectPhotoView(
  object: Pick<SceneObject, "position" | "rotation" | "type">,
  set: PhotoAssetSet,
): SelectedPhotoView {
  const first = set.views[0];
  if (!first) throw new Error(`photo-views: asset set ${set.id} has no views`);
  if (isRadial(object.type, set)) {
    return {
      view: first,
      mirrored: false,
      frontVector: first.frontVector,
      anchorX: first.anchorX,
      angleDegrees: 0,
      exact: true,
    };
  }

  const facing = facingOf(object.rotation[1]);
  const scored = candidatesFor(set).map((candidate) => ({
    candidate,
    angleDegrees: candidateAngleDegrees(candidate, facing, set.symmetry),
  }));
  const closest = Math.min(...scored.map((entry) => entry.angleDegrees));
  // A yaw-0 object matches the front-quarter pair equally; turn it inward, and
  // on the centre line keep the photographed orientation (spec 6 rule 4).
  const preferPositiveX = object.position[0] <= 0;
  // Within a few degrees of straight-on the mirrored and native twins are
  // interchangeable, so the room-centre rule decides instead of the sign of a
  // tiny yaw — otherwise a 5° nudge would flip the whole cutout.
  const straightOnDegrees = Math.min(
    angleBetweenDegrees(facing, { x: 0, z: 1 }),
    set.symmetry === "front-back"
      ? angleBetweenDegrees(facing, { x: 0, z: -1 })
      : 180,
  );
  const tieWindow =
    straightOnDegrees <= STRAIGHT_ON_DEGREES ? STRAIGHT_ON_TIE_DEGREES : TIE_DEGREES;
  const best = scored
    .filter((entry) => entry.angleDegrees <= closest + tieWindow)
    .sort((left, right) =>
      compareTieRanks(
        tieRank(left.candidate, preferPositiveX),
        tieRank(right.candidate, preferPositiveX),
      ),
    )[0]!;

  return {
    view: best.candidate.view,
    mirrored: best.candidate.mirrored,
    frontVector: best.candidate.frontVector,
    anchorX: best.candidate.anchorX,
    angleDegrees: best.angleDegrees,
    exact: best.angleDegrees <= COVERAGE_DEGREES,
  };
}

/** How truthfully the set can show a facing: 0 when no view covers it. */
export function viewFidelity(facing: FacingVector, set: PhotoAssetSet): number {
  if (set.symmetry === "radial") return 1;
  let best = 0;
  for (const candidate of candidatesFor(set)) {
    const angle = candidateAngleDegrees(candidate, facing, set.symmetry);
    if (angle > COVERAGE_DEGREES) continue;
    const fidelity =
      ORIGIN_WEIGHT[candidate.view.origin] *
      (candidate.mirrored ? MIRROR_WEIGHT : 1);
    if (fidelity > best) best = fidelity;
  }
  return best;
}

export function rotationOptionsFor(
  object: Pick<SceneObject, "rotation" | "type" | "assetId">,
  set: PhotoAssetSet | null,
): readonly RotationOption[] {
  if (set === null || isRadial(object.type, set)) {
    return [{ rotationY: object.rotation[1], fidelity: 1 }];
  }

  // The stage accumulates rotations without bounds, so fold the incumbent into
  // (-π, π] before comparing it with the grid: 2π must not appear beside 0.
  const current = rotationYOf(facingOf(object.rotation[1]));

  const options: RotationOption[] = [];
  for (let k = -3; k <= 4; k += 1) {
    const rotationY = k * ROTATION_STEP;
    const fidelity = viewFidelity(facingOf(rotationY), set);
    if (fidelity > 0) options.push({ rotationY, fidelity });
  }
  if (
    !options.some(
      (option) => Math.abs(option.rotationY - current) <= ROTATION_EPSILON,
    )
  ) {
    const fidelity = viewFidelity(facingOf(current), set);
    options.push({
      rotationY: current,
      fidelity: fidelity > 0 ? fidelity : INCUMBENT_FIDELITY,
    });
  }
  return options.sort((left, right) => left.rotationY - right.rotationY);
}

export function buildRotationOptions(
  scene: Scene,
): Readonly<Record<string, readonly RotationOption[]>> {
  return Object.freeze(
    Object.fromEntries(
      scene.objects.map((object) => [
        object.id,
        rotationOptionsFor(object, getPhotoAssetSet(object)),
      ]),
    ),
  );
}
