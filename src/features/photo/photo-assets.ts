import type { SceneObject } from "../scene/scene-schema";

export interface PhotoAsset {
  id: string;
  src: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  anchorX: number;
  anchorY: number;
}

export const ROOM_PHOTO_ASSETS = {
  empty: {
    id: "nook-room-empty",
    src: "/demo/photo/nook-room-empty.webp",
    intrinsicWidth: 1600,
    intrinsicHeight: 900,
  },
  before: {
    id: "nook-room-before",
    src: "/demo/photo/nook-room-before.webp",
    intrinsicWidth: 1600,
    intrinsicHeight: 900,
  },
} as const;

export const NOOK_ROOM_BACKGROUND = ROOM_PHOTO_ASSETS.empty.src;
export const NOOK_ROOM_BEFORE = ROOM_PHOTO_ASSETS.before.src;

export const PHOTO_ASSETS: Record<string, PhotoAsset> = {
  "seed-dated-sofa": { id: "seed-dated-sofa", src: "/demo/photo/seed/seed-dated-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.4974, anchorY: 0.9102 },
  "seed-glass-table": { id: "seed-glass-table", src: "/demo/photo/seed/seed-glass-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5007, anchorY: 0.8613 },
  "seed-pattern-rug": { id: "seed-pattern-rug", src: "/demo/photo/seed/seed-pattern-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5023, anchorY: 1 },
  "seed-brass-lamp": { id: "seed-brass-lamp", src: "/demo/photo/seed/seed-brass-lamp.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.501, anchorY: 0.9883 },
  "seed-vinyl-chair": { id: "seed-vinyl-chair", src: "/demo/photo/seed/seed-vinyl-chair.webp", intrinsicWidth: 1382, intrinsicHeight: 1138, anchorX: 0.5, anchorY: 0.9473 },
  "seed-faux-plant": { id: "seed-faux-plant", src: "/demo/photo/seed/seed-faux-plant.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.5205, anchorY: 0.974 },
  "hinoki-low-sofa": { id: "hinoki-low-sofa", src: "/demo/photo/products/hinoki-low-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5, anchorY: 0.8584 },
  "boucle-curve-sofa": { id: "boucle-curve-sofa", src: "/demo/photo/products/boucle-curve-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.4997, anchorY: 0.8604 },
  "walnut-frame-sofa": { id: "walnut-frame-sofa", src: "/demo/photo/products/walnut-frame-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5042, anchorY: 0.8789 },
  "oak-frame-table": { id: "oak-frame-table", src: "/demo/photo/products/oak-frame-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5094, anchorY: 0.8418 },
  "travertine-plinth-table": { id: "travertine-plinth-table", src: "/demo/photo/products/travertine-plinth-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5003, anchorY: 0.8369 },
  "walnut-nesting-table": { id: "walnut-nesting-table", src: "/demo/photo/products/walnut-nesting-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5166, anchorY: 0.8711 },
  "woven-jute-rug": { id: "woven-jute-rug", src: "/demo/photo/products/woven-jute-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.4984, anchorY: 0.9131 },
  "wool-pebble-rug": { id: "wool-pebble-rug", src: "/demo/photo/products/wool-pebble-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5046, anchorY: 0.8574 },
  "geometric-flatweave-rug": { id: "geometric-flatweave-rug", src: "/demo/photo/products/geometric-flatweave-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5007, anchorY: 0.9482 },
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

export function getPhotoAsset(object: SceneObject): PhotoAsset | null {
  return object.assetId ? PHOTO_ASSETS[object.assetId] ?? null : null;
}
