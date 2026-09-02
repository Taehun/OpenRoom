import { expect, test } from "@playwright/test";

import {
  PHOTO_ASSETS,
  ROOM_PHOTO_ASSETS,
} from "../../src/features/photo/photo-assets";

test("audits every registered room and cutout image in the browser", async ({
  page,
}) => {
  const rooms = Object.values(ROOM_PHOTO_ASSETS);
  const cutouts = Object.values(PHOTO_ASSETS);
  const assets = [...rooms, ...cutouts].map(({ id, src }) => ({ id, src }));

  await page.goto("/demo");
  const audits = await page.evaluate(async (registeredAssets) => {
    async function inspect({ id, src }: { id: string; src: string }) {
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
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        minimumAlpha,
        maximumAlpha,
      };
    }

    return Promise.all(registeredAssets.map(inspect));
  }, assets);
  expect(audits, "Expected every registered asset to load").toHaveLength(26);

  const auditById = new Map(audits.map((audit) => [audit.id, audit]));
  for (const room of rooms) {
    const audit = auditById.get(room.id);
    expect(audit, `Missing audit for ${room.id}`).toBeDefined();
    expect(audit!.naturalWidth, `${room.id} width`).toBe(1600);
    expect(audit!.naturalHeight, `${room.id} height`).toBe(900);
    expect(audit!.minimumAlpha, `${room.id} minimum alpha`).toBe(255);
    expect(audit!.maximumAlpha, `${room.id} maximum alpha`).toBe(255);
  }

  for (const cutout of cutouts) {
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
});
