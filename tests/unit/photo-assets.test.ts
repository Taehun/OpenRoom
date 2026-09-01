import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDemoScene } from "../../src/demo/demo-scene";
import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import {
  NOOK_ROOM_BACKGROUND,
  PHOTO_ASSETS,
  getPhotoAsset,
} from "../../src/features/photo/photo-assets";

const categories = [
  "sofa", "coffee_table", "rug", "floor_lamp", "chair", "plant",
] as const;

describe("photo assets", () => {
  it("has three stable products for every category", () => {
    for (const category of categories) {
      expect(DEMO_PRODUCTS.filter((item) => item.category === category))
        .toHaveLength(3);
    }
    expect(DEMO_PRODUCTS.filter((item) => item.category === "coffee_table")
      .map((item) => item.id)).toEqual([
        "oak-frame-table",
        "travertine-plinth-table",
        "walnut-nesting-table",
      ]);
  });

  it("resolves every seed and catalog object to a checked-in file", () => {
    const objects = createDemoScene().objects;
    for (const object of objects) expect(getPhotoAsset(object)).not.toBeNull();
    for (const product of DEMO_PRODUCTS) {
      const asset = PHOTO_ASSETS[product.id];
      expect(asset).toBeDefined();
      expect(existsSync(join(process.cwd(), "public", asset.src))).toBe(true);
    }
    expect(existsSync(join(process.cwd(), "public", NOOK_ROOM_BACKGROUND)))
      .toBe(true);
  });

  it("anchors floor-contact tables and rugs to meaningful alpha", () => {
    const expectedAnchorY = {
      "oak-frame-table": 0.8418,
      "travertine-plinth-table": 0.8369,
      "walnut-nesting-table": 0.8711,
      "woven-jute-rug": 0.9131,
      "wool-pebble-rug": 0.8574,
      "geometric-flatweave-rug": 0.9482,
    } as const;

    for (const [id, anchorY] of Object.entries(expectedAnchorY)) {
      expect(PHOTO_ASSETS[id]?.anchorY).toBeCloseTo(anchorY, 4);
      expect(PHOTO_ASSETS[id]?.anchorY).toBeLessThan(1);
    }
  });
});
