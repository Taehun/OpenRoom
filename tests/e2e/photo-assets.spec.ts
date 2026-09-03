import { expect, test } from "@playwright/test";

import {
  PHOTO_ASSETS,
  ROOM_PHOTO_ASSETS,
} from "../../src/features/photo/photo-assets";
import { GENERATED_PRODUCT_ASSETS } from "../../src/features/photo/photo-products.generated";
import { GENERATED_VIEW_MANIFEST } from "../../src/features/photo/photo-views.generated";

test("audits every registered room and cutout image in the browser", async ({
  page,
}) => {
  const rooms = Object.values(ROOM_PHOTO_ASSETS);
  // `PHOTO_ASSETS` is already the union of the 24 hand-registered cutouts and
  // whatever `pnpm assets:products` generated, so every product cutout —
  // photographed or generated — is audited exactly once here.
  const cutouts = Object.values(PHOTO_ASSETS);
  const products = GENERATED_PRODUCT_ASSETS;
  // Generated views are ordinary committed cutouts: audit each one the manifest
  // registers, so a wrong dimension or a flattened alpha channel fails here.
  const generated = GENERATED_VIEW_MANIFEST.views.map((view) => ({
    id: `${view.assetId}--${view.view}`,
    src: view.src,
    intrinsicWidth: view.intrinsicWidth,
    intrinsicHeight: view.intrinsicHeight,
  }));
  const assets = [
    ...rooms.map(({ id, src }) => ({ id, src })),
    ...cutouts.map(({ id, src, floorQuad }) => ({ id, src, floorQuad })),
    ...generated.map(({ id, src }) => ({ id, src })),
  ];

  await page.goto("/demo");
  const audits = await page.evaluate(async (registeredAssets) => {
    async function inspect({
      id,
      src,
      floorQuad,
    }: {
      id: string;
      src: string;
      floorQuad?: readonly { x: number; y: number }[];
    }) {
      const image = new Image();
      image.src = src;
      try {
        await image.decode();
      } catch (error) {
        throw new Error(`Could not decode ${id}: ${String(error)}`);
      }

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error(`Could not create canvas context for ${id}`);
      context.drawImage(image, 0, 0);

      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let minimumAlpha = 255;
      let maximumAlpha = 0;
      for (let index = 3; index < data.length; index += 4) {
        const alpha = data[index]!;
        minimumAlpha = Math.min(minimumAlpha, alpha);
        maximumAlpha = Math.max(maximumAlpha, alpha);
      }

      return {
        id,
        floorQuad,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        minimumAlpha,
        maximumAlpha,
      };
    }

    return Promise.all(registeredAssets.map(inspect));
  }, assets);
  expect(audits, "Expected every registered asset to load").toHaveLength(
    26 + generated.length + products.length,
  );

  const auditById = new Map(audits.map((audit) => [audit.id, audit]));
  for (const room of rooms) {
    const audit = auditById.get(room.id);
    expect(audit, `Missing audit for ${room.id}`).toBeDefined();
    expect(audit!.naturalWidth, `${room.id} width`).toBe(1600);
    expect(audit!.naturalHeight, `${room.id} height`).toBe(900);
    expect(audit!.minimumAlpha, `${room.id} minimum alpha`).toBe(255);
    expect(audit!.maximumAlpha, `${room.id} maximum alpha`).toBe(255);
  }

  for (const cutout of [...cutouts, ...generated]) {
    const audit = auditById.get(cutout.id);
    expect(audit, `Missing audit for ${cutout.id}`).toBeDefined();
    expect(audit!.naturalWidth, `${cutout.id} width`).toBe(
      cutout.intrinsicWidth,
    );
    expect(audit!.naturalHeight, `${cutout.id} height`).toBe(
      cutout.intrinsicHeight,
    );
    expect(audit!.minimumAlpha, `${cutout.id} minimum alpha`).toBe(0);
    expect(audit!.maximumAlpha, `${cutout.id} maximum alpha`).toBeGreaterThan(0);
  }

  expect(
    audits
      .filter(({ floorQuad }) => floorQuad !== undefined)
      .map(({ id }) => id)
      .sort(),
  ).toEqual(
    [
      "geometric-flatweave-rug",
      "seed-pattern-rug",
      "wool-pebble-rug",
      "woven-jute-rug",
      // A rug the pipeline generated carries a bbox quad; it is registered
      // through `PHOTO_ASSETS` like any other, so it belongs in this list too.
      ...products.filter(({ floorQuad }) => floorQuad).map(({ id }) => id),
    ].sort(),
  );
});
