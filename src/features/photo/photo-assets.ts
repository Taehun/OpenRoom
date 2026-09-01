import type { SceneObject } from "../scene/scene-schema";

export interface PhotoAsset {
  id: string;
  src: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  anchorX: number;
  anchorY: number;
}

export const NOOK_ROOM_BACKGROUND = "/demo/photo/nook-room-empty.webp";
export const NOOK_ROOM_BEFORE = "/demo/photo/nook-room-before.webp";

export const PHOTO_ASSETS: Record<string, PhotoAsset> = {
  "seed-dated-sofa": { id: "seed-dated-sofa", src: "/demo/photo/seed/seed-dated-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5029, anchorY: 0.9609 },
  "seed-glass-table": { id: "seed-glass-table", src: "/demo/photo/seed/seed-glass-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5036, anchorY: 0.9746 },
  "seed-pattern-rug": { id: "seed-pattern-rug", src: "/demo/photo/seed/seed-pattern-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5, anchorY: 1 },
  "seed-brass-lamp": { id: "seed-brass-lamp", src: "/demo/photo/seed/seed-brass-lamp.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.4556, anchorY: 0.9948 },
  "seed-vinyl-chair": { id: "seed-vinyl-chair", src: "/demo/photo/seed/seed-vinyl-chair.webp", intrinsicWidth: 1382, intrinsicHeight: 1138, anchorX: 0.4949, anchorY: 0.9772 },
  "seed-faux-plant": { id: "seed-faux-plant", src: "/demo/photo/seed/seed-faux-plant.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.5171, anchorY: 0.9805 },
  "hinoki-low-sofa": { id: "hinoki-low-sofa", src: "/demo/photo/products/hinoki-low-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.501, anchorY: 0.9746 },
  "boucle-curve-sofa": { id: "boucle-curve-sofa", src: "/demo/photo/products/boucle-curve-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.4984, anchorY: 0.9541 },
  "walnut-frame-sofa": { id: "walnut-frame-sofa", src: "/demo/photo/products/walnut-frame-sofa.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5042, anchorY: 0.9746 },
  "oak-frame-table": { id: "oak-frame-table", src: "/demo/photo/products/oak-frame-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5127, anchorY: 1 },
  "travertine-plinth-table": { id: "travertine-plinth-table", src: "/demo/photo/products/travertine-plinth-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5, anchorY: 1 },
  "walnut-nesting-table": { id: "walnut-nesting-table", src: "/demo/photo/products/walnut-nesting-table.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5003, anchorY: 1 },
  "woven-jute-rug": { id: "woven-jute-rug", src: "/demo/photo/products/woven-jute-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.4987, anchorY: 1 },
  "wool-pebble-rug": { id: "wool-pebble-rug", src: "/demo/photo/products/wool-pebble-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5023, anchorY: 1 },
  "geometric-flatweave-rug": { id: "geometric-flatweave-rug", src: "/demo/photo/products/geometric-flatweave-rug.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.4945, anchorY: 1 },
  "rice-paper-floor-lamp": { id: "rice-paper-floor-lamp", src: "/demo/photo/products/rice-paper-floor-lamp.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.5171, anchorY: 0.9727 },
  "linen-dome-lamp": { id: "linen-dome-lamp", src: "/demo/photo/products/linen-dome-lamp.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.4995, anchorY: 1 },
  "brass-globe-lamp": { id: "brass-globe-lamp", src: "/demo/photo/products/brass-globe-lamp.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.5171, anchorY: 0.9818 },
  "ash-lounge-chair": { id: "ash-lounge-chair", src: "/demo/photo/products/ash-lounge-chair.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.4938, anchorY: 0.9766 },
  "boucle-barrel-chair": { id: "boucle-barrel-chair", src: "/demo/photo/products/boucle-barrel-chair.webp", intrinsicWidth: 1312, intrinsicHeight: 1199, anchorX: 0.5152, anchorY: 1 },
  "cognac-sling-chair": { id: "cognac-sling-chair", src: "/demo/photo/products/cognac-sling-chair.webp", intrinsicWidth: 1536, intrinsicHeight: 1024, anchorX: 0.5153, anchorY: 1 },
  "ceramic-olive-tree": { id: "ceramic-olive-tree", src: "/demo/photo/products/ceramic-olive-tree.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.4922, anchorY: 1 },
  "stone-planter-ficus": { id: "stone-planter-ficus", src: "/demo/photo/products/stone-planter-ficus.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.4893, anchorY: 1 },
  "teak-planter-palm": { id: "teak-planter-palm", src: "/demo/photo/products/teak-planter-palm.webp", intrinsicWidth: 1024, intrinsicHeight: 1536, anchorX: 0.4941, anchorY: 1 },
};

export function getPhotoAsset(object: SceneObject): PhotoAsset | null {
  return object.assetId ? PHOTO_ASSETS[object.assetId] ?? null : null;
}
