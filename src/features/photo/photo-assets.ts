import { z } from "zod";

import type { SceneObject } from "../scene/scene-schema";
import type { NormalizedPoint } from "./photo-calibration";
import { GENERATED_PRODUCT_ASSETS } from "./photo-products.generated";

export type NormalizedQuad = readonly [
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
];

export interface PhotoAsset {
  id: string;
  src: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  anchorX: number;
  anchorY: number;
  floorQuad?: NormalizedQuad;
}

/**
 * One cutout written by `pnpm assets:products`. `provider`, `model` and
 * `generatedAt` are provenance only and never reach the compositor;
 * `quadSource: "bbox"` marks a rug quad that was derived from the alpha
 * bounding box rather than measured by hand.
 */
export interface GeneratedProductAsset {
  id: string;
  src: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  anchorX: number;
  anchorY: number;
  floorQuad?: NormalizedQuad;
  quadSource?: "bbox";
  provider: "openai" | "gemini";
  model: string;
  generatedAt: string;
}

const NormalizedPointSchema = z
  .object({ x: z.number(), y: z.number() })
  .strict();

export const GeneratedProductAssetSchema = z
  .object({
    id: z.string().min(1),
    src: z.string().startsWith("/demo/photo/"),
    intrinsicWidth: z.number().int().positive(),
    intrinsicHeight: z.number().int().positive(),
    anchorX: z.number().min(0).max(1),
    anchorY: z.number().min(0).max(1),
    floorQuad: z
      .tuple([
        NormalizedPointSchema,
        NormalizedPointSchema,
        NormalizedPointSchema,
        NormalizedPointSchema,
      ])
      .optional(),
    quadSource: z.literal("bbox").optional(),
    provider: z.enum(["openai", "gemini"]),
    model: z.string().min(1),
    generatedAt: z.iso.datetime(),
  })
  .strict() satisfies z.ZodType<GeneratedProductAsset>;

const RUG_FLOOR_QUADS = {
  "seed-pattern-rug": [
    { x: 0.439, y: 0.112 },
    { x: 0.995, y: 0.367 },
    { x: 0.304, y: 0.986 },
    { x: 0.008, y: 0.224 },
  ],
  "woven-jute-rug": [
    { x: 0.508, y: 0.221 },
    { x: 0.97, y: 0.322 },
    { x: 0.756, y: 0.92 },
    { x: 0.012, y: 0.589 },
  ],
  "wool-pebble-rug": [
    { x: 0.31, y: 0.205 },
    { x: 0.962, y: 0.492 },
    { x: 0.793, y: 0.834 },
    { x: 0.029, y: 0.607 },
  ],
  "geometric-flatweave-rug": [
    { x: 0.521, y: 0.206 },
    { x: 0.982, y: 0.691 },
    { x: 0.182, y: 0.928 },
    { x: 0.022, y: 0.301 },
  ],
} as const satisfies Record<string, NormalizedQuad>;

export const ROOM_PHOTO_ASSETS = {
  empty: {
    id: "openroom-room-empty",
    src: "/demo/photo/openroom-room-empty.webp",
    intrinsicWidth: 1600,
    intrinsicHeight: 900,
  },
  before: {
    id: "openroom-room-before",
    src: "/demo/photo/openroom-room-before.webp",
    intrinsicWidth: 1600,
    intrinsicHeight: 900,
  },
} as const;

export const OPENROOM_ROOM_BACKGROUND = ROOM_PHOTO_ASSETS.empty.src;
export const OPENROOM_ROOM_BEFORE = ROOM_PHOTO_ASSETS.before.src;

const HAND_REGISTERED_ASSETS: Record<string, PhotoAsset> = {
  "seed-dated-sofa": { id: "seed-dated-sofa", src: "/demo/photo/seed/seed-dated-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.4974, anchorY: 0.9102 },
  "seed-glass-table": { id: "seed-glass-table", src: "/demo/photo/seed/seed-glass-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5007, anchorY: 0.8613 },
  "seed-pattern-rug": { id: "seed-pattern-rug", src: "/demo/photo/seed/seed-pattern-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5023, anchorY: 1, floorQuad: RUG_FLOOR_QUADS["seed-pattern-rug"] },
  "seed-brass-lamp": { id: "seed-brass-lamp", src: "/demo/photo/seed/seed-brass-lamp.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.501, anchorY: 0.9883 },
  "seed-vinyl-chair": { id: "seed-vinyl-chair", src: "/demo/photo/seed/seed-vinyl-chair.webp", intrinsicWidth: 1382, intrinsicHeight: 1138, anchorX: 0.5, anchorY: 0.9473 },
  "seed-faux-plant": { id: "seed-faux-plant", src: "/demo/photo/seed/seed-faux-plant.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.5205, anchorY: 0.974 },
  "hinoki-low-sofa": { id: "hinoki-low-sofa", src: "/demo/photo/products/hinoki-low-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5, anchorY: 0.8584 },
  "boucle-curve-sofa": { id: "boucle-curve-sofa", src: "/demo/photo/products/boucle-curve-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.4997, anchorY: 0.8604 },
  "walnut-frame-sofa": { id: "walnut-frame-sofa", src: "/demo/photo/products/walnut-frame-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5042, anchorY: 0.8789 },
  "oak-frame-table": { id: "oak-frame-table", src: "/demo/photo/products/oak-frame-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5094, anchorY: 0.8418 },
  "travertine-plinth-table": { id: "travertine-plinth-table", src: "/demo/photo/products/travertine-plinth-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5003, anchorY: 0.8369 },
  "walnut-nesting-table": { id: "walnut-nesting-table", src: "/demo/photo/products/walnut-nesting-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5166, anchorY: 0.8711 },
  "woven-jute-rug": { id: "woven-jute-rug", src: "/demo/photo/products/woven-jute-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.4984, anchorY: 0.9131, floorQuad: RUG_FLOOR_QUADS["woven-jute-rug"] },
  "wool-pebble-rug": { id: "wool-pebble-rug", src: "/demo/photo/products/wool-pebble-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5046, anchorY: 0.8574, floorQuad: RUG_FLOOR_QUADS["wool-pebble-rug"] },
  "geometric-flatweave-rug": { id: "geometric-flatweave-rug", src: "/demo/photo/products/geometric-flatweave-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5007, anchorY: 0.9482, floorQuad: RUG_FLOOR_QUADS["geometric-flatweave-rug"] },
  "rice-paper-floor-lamp": { id: "rice-paper-floor-lamp", src: "/demo/photo/products/rice-paper-floor-lamp.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.5337, anchorY: 0.9674 },
  "linen-dome-lamp": { id: "linen-dome-lamp", src: "/demo/photo/products/linen-dome-lamp.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.5, anchorY: 0.9974 },
  "brass-globe-lamp": { id: "brass-globe-lamp", src: "/demo/photo/products/brass-globe-lamp.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.5142, anchorY: 0.974 },
  "ash-lounge-chair": { id: "ash-lounge-chair", src: "/demo/photo/products/ash-lounge-chair.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5068, anchorY: 0.9629 },
  "boucle-barrel-chair": { id: "boucle-barrel-chair", src: "/demo/photo/products/boucle-barrel-chair.webp", intrinsicWidth: 1312, intrinsicHeight: 1199, anchorX: 0.5069, anchorY: 0.9491 },
  "cognac-sling-chair": { id: "cognac-sling-chair", src: "/demo/photo/products/cognac-sling-chair.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5072, anchorY: 0.9766 },
  "ceramic-olive-tree": { id: "ceramic-olive-tree", src: "/demo/photo/products/ceramic-olive-tree.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.5117, anchorY: 0.9818 },
  "stone-planter-ficus": { id: "stone-planter-ficus", src: "/demo/photo/products/stone-planter-ficus.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.5073, anchorY: 0.9844 },
  "teak-planter-palm": { id: "teak-planter-palm", src: "/demo/photo/products/teak-planter-palm.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.5127, anchorY: 0.9876 },
};

/** Validated at import, so a malformed generated entry fails loudly. */
const GENERATED_ASSETS: readonly GeneratedProductAsset[] =
  GENERATED_PRODUCT_ASSETS.map((entry) =>
    GeneratedProductAssetSchema.parse(entry),
  );

function toPhotoAsset(entry: GeneratedProductAsset): PhotoAsset {
  return {
    id: entry.id,
    src: entry.src,
    intrinsicWidth: entry.intrinsicWidth,
    intrinsicHeight: entry.intrinsicHeight,
    anchorX: entry.anchorX,
    anchorY: entry.anchorY,
    ...(entry.floorQuad ? { floorQuad: entry.floorQuad } : {}),
  };
}

/**
 * The union of the hand-registered cutouts and the ones `pnpm assets:products`
 * generated. A hand-registered entry always wins: the pinned catalog assets,
 * anchors, and quads never change.
 */
export const PHOTO_ASSETS: Record<string, PhotoAsset> = {
  ...Object.fromEntries(
    GENERATED_ASSETS.map((entry) => [entry.id, toPhotoAsset(entry)]),
  ),
  ...HAND_REGISTERED_ASSETS,
};

/**
 * The catalog products the product pipeline still has to photograph. Takes the
 * catalog rather than importing it, so the pipeline and its tests can plan over
 * a fixture list.
 */
export function productsWithoutAssets<T extends { id: string }>(
  products: readonly T[],
  assets: Readonly<Record<string, PhotoAsset>> = PHOTO_ASSETS,
): T[] {
  return products.filter((product) => !assets[product.id]);
}

export function getPhotoAsset(object: SceneObject): PhotoAsset | null {
  return object.assetId ? PHOTO_ASSETS[object.assetId] ?? null : null;
}
