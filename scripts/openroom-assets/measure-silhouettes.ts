/**
 * Measures the alpha content box of every registered cutout and writes
 * `src/features/photo/photo-silhouettes.generated.ts`. The compositor sizes a
 * cutout so that this box — not the whole image — spans the product's real
 * silhouette width, which is what keeps a lamp that fills a third of its frame
 * at the same scale as a sofa that fills nearly all of it.
 *
 * Developer-run only: `pnpm assets:measure`. Never runs in CI or the app.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

const DIRS = ["public/demo/photo/products", "public/demo/photo/seed"];
const OUTPUT = "src/features/photo/photo-silhouettes.generated.ts";
const ALPHA_THRESHOLD = 16;

interface ContentBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function measureContentBox(
  rgba: Uint8Array,
  width: number,
  height: number,
): ContentBox | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) >= ALPHA_THRESHOLD) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return {
    left: round(left / width),
    right: round((right + 1) / width),
    top: round(top / height),
    bottom: round((bottom + 1) / height),
  };
}

export function renderSilhouettesModule(
  boxes: Readonly<Record<string, ContentBox>>,
): string {
  const entries = Object.keys(boxes)
    .sort()
    .map((id) => {
      const box = boxes[id]!;
      return `  ${JSON.stringify(id)}: { left: ${box.left}, right: ${box.right}, top: ${box.top}, bottom: ${box.bottom} },`;
    });
  return [
    'import type { CutoutContentBox } from "./photo-assets";',
    "",
    "/**",
    " * Alpha content box of every registered cutout, as fractions of the image.",
    " * Written by `pnpm assets:measure`; do not edit by hand.",
    " */",
    "export const CUTOUT_SILHOUETTES: Readonly<Record<string, CutoutContentBox>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const boxes: Record<string, ContentBox> = {};
  for (const dir of DIRS) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".webp"))) {
      const { data, info } = await sharp(join(dir, file))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const box = measureContentBox(new Uint8Array(data), info.width, info.height);
      if (!box) throw new Error(`${file} has no opaque pixel`);
      boxes[file.replace(/\.webp$/, "")] = box;
    }
  }
  writeFileSync(OUTPUT, renderSilhouettesModule(boxes));
  console.log(`[measure] wrote ${Object.keys(boxes).length} content boxes to ${OUTPUT}`);
}

if (process.argv[1]?.endsWith("measure-silhouettes.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
