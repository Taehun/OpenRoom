import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoScene } from "../../src/demo/demo-scene";
import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import {
  NOOK_ROOM_BACKGROUND,
  PHOTO_ASSETS,
  ROOM_PHOTO_ASSETS,
  getPhotoAsset,
} from "../../src/features/photo/photo-assets";
import { readWebpMetadata } from "../helpers/webp-metadata";

const categories = [
  "sofa", "coffee_table", "rug", "floor_lamp", "chair", "plant",
] as const;

const malformedWebpFixtures = [
  [
    "an invalid RIFF signature",
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    "missing RIFF/WEBP signature",
  ],
  [
    "a truncated RIFF container",
    Buffer.from([0x52, 0x49, 0x46, 0x46, 0x14, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    "truncated RIFF container",
  ],
  [
    "a truncated image chunk",
    Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, 0, 0, 0,
    ]),
    "truncated VP8L chunk",
  ],
  [
    "a truncated odd-length chunk padding byte",
    Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x0d, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      0x4a, 0x55, 0x4e, 0x4b, 1, 0, 0, 0, 0,
    ]),
    "truncated JUNK padding",
  ],
  [
    "a container without an image chunk",
    Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x0c, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      0x4a, 0x55, 0x4e, 0x4b, 0, 0, 0, 0,
    ]),
    "missing image chunk",
  ],
  [
    "a VP8 frame with zero dimensions",
    Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x16, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x20, 0x0a, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a,
      0, 0, 1, 0,
    ]),
    "zero dimensions",
  ],
  [
    "an invalid VP8 frame header",
    Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x16, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x20, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0x01, 0x2a,
      1, 0, 1, 0,
    ]),
    "invalid VP8 frame header",
  ],
  [
    "an invalid VP8L signature",
    Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x12, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]),
    "invalid VP8L signature",
  ],
] as const;

const invalidVp8lVersion = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x12, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, 0, 0, 0, 0x20, 0,
]);

describe("photo assets", () => {
  let fixtureDirectory: string;

  beforeEach(() => {
    fixtureDirectory = mkdtempSync(join(tmpdir(), "nook-webp-metadata-"));
  });

  afterEach(() => {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  });

  it("rejects a VP8L bitstream with a nonzero version", () => {
    const fixturePath = join(fixtureDirectory, "nonzero-vp8l-version.webp");
    writeFileSync(fixturePath, invalidVp8lVersion);

    expect(() => readWebpMetadata(fixturePath)).toThrow(
      "invalid VP8L version",
    );
  });

  it.each(malformedWebpFixtures)("rejects %s", (_name, bytes, message) => {
    const fixturePath = join(fixtureDirectory, `${_name}.webp`);
    writeFileSync(fixturePath, bytes);

    expect(() => readWebpMetadata(fixturePath)).toThrow(message);
  });

  it("registers the complete room and cutout asset inventory with matching WebP metadata", () => {
    expect(Object.keys(ROOM_PHOTO_ASSETS)).toHaveLength(2);
    expect(Object.keys(PHOTO_ASSETS)).toHaveLength(24);
    expect(
      Object.keys(ROOM_PHOTO_ASSETS).length + Object.keys(PHOTO_ASSETS).length,
    )
      .toBe(26);

    for (const room of Object.values(ROOM_PHOTO_ASSETS)) {
      const metadata = readWebpMetadata(join(process.cwd(), "public", room.src));
      expect(metadata.width).toBe(1600);
      expect(metadata.height).toBe(900);
      expect(metadata.hasAlpha).toBe(false);
      expect(room.intrinsicWidth).toBe(1600);
      expect(room.intrinsicHeight).toBe(900);
    }

    for (const asset of Object.values(PHOTO_ASSETS)) {
      const metadata = readWebpMetadata(join(process.cwd(), "public", asset.src));
      expect(metadata.width).toBe(asset.intrinsicWidth);
      expect(metadata.height).toBe(asset.intrinsicHeight);
      expect(metadata.hasAlpha).toBe(true);
    }
  });

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
