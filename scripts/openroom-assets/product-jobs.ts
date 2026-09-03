/**
 * Pure core of the offline product pipeline (`pnpm assets:products`): argument
 * parsing, job planning, the prompt, white-studio background removal, the rug
 * floor quad, and manifest merging. No I/O, no env, no network —
 * `generate-products.ts` is the shell that supplies all of those. The app never
 * imports either file.
 */
import {
  GeneratedProductAssetSchema,
  type GeneratedProductAsset,
  type NormalizedQuad,
  type PhotoAsset,
} from "../../src/features/photo/photo-assets";
import type { AspectRatio } from "./providers";

export { geminiRequestBody } from "./providers";
export type { AspectRatio } from "./providers";

/** Only what planning needs; the live `DemoProduct` satisfies it structurally. */
export interface CatalogProduct {
  id: string;
  title: string;
  category: string;
  description: string;
}

export interface ProductJob {
  productId: string;
  title: string;
  description: string;
  category: string;
  aspect: AspectRatio;
  outputSrc: string;
}

export interface ProductCliOptions {
  dryRun: boolean;
  force: boolean;
  products: string[];
  /**
   * A registered cutout whose camera angle every generated image must match;
   * sent to the model as an image part next to the prompt.
   */
  angleReference: string | null;
}

const PRODUCTS_DIR = "/demo/photo/products";

/**
 * Wide categories are photographed landscape, tall ones portrait. Written with
 * string keys so this module compiles whether or not the two new `SceneObjectType`
 * values have landed yet; anything unlisted falls back to landscape.
 */
const ASPECT_BY_CATEGORY: Readonly<Record<string, AspectRatio>> = Object.freeze({
  sofa: "3:2",
  coffee_table: "3:2",
  rug: "3:2",
  bookshelf: "2:3",
  chair: "3:2",
  floor_lamp: "2:3",
  plant: "2:3",
  side_table: "2:3",
});

const DEFAULT_ASPECT: AspectRatio = "3:2";

/** Pixels this opaque or better count as product, exactly as for views. */
const ALPHA_THRESHOLD = 16;
/** Per-channel distance from a sampled corner colour that still counts as background. */
const BACKGROUND_TOLERANCE = 18;
const QUAD_DECIMALS = 4;
/** How far the rug's back edge is pulled in from the bounding box. */
const BACK_EDGE_INSET = 0.1;

const MANIFEST_MODULE_HEADER = [
  'import type { GeneratedProductAsset } from "./photo-assets";',
  "",
  "/** Written by `pnpm assets:products`; do not edit by hand. */",
].join("\n");

export function aspectFor(category: string): AspectRatio {
  return ASPECT_BY_CATEGORY[category] ?? DEFAULT_ASPECT;
}

export function outputSrcForProduct(productId: string): string {
  return `${PRODUCTS_DIR}/${productId}.webp`;
}

export function parseProductArgs(argv: readonly string[]): ProductCliOptions {
  const options: ProductCliOptions = {
    dryRun: false,
    force: false,
    angleReference: null,
    products: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    switch (token) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--angle-reference": {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new Error("--angle-reference needs a registered asset id");
        }
        options.angleReference = value;
        index += 1;
        break;
      }
      case "--force":
        options.force = true;
        break;
      case "--product": {
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) {
          throw new Error("--product requires a product id");
        }
        options.products.push(value);
        index += 1;
        break;
      }
      default:
        throw new Error(`unknown argument: ${token}`);
    }
  }

  return options;
}

/**
 * Every catalog product that has no registered cutout, in catalog order.
 * `--force` regenerates entries this pipeline wrote before; a hand-registered
 * cutout is never overwritten, because the pinned catalog assets do not change.
 */
export function planProductJobs(
  products: readonly CatalogProduct[],
  assets: Readonly<Record<string, PhotoAsset>>,
  manifest: readonly GeneratedProductAsset[],
  options: ProductCliOptions,
): ProductJob[] {
  const known = new Set(products.map((product) => product.id));
  for (const id of options.products) {
    if (!known.has(id)) {
      throw new Error(
        `--product ${id} is not a catalog product; see src/features/demo/demo-data.ts`,
      );
    }
  }

  const generated = new Set(manifest.map((entry) => entry.id));
  const wanted = new Set(options.products);
  const jobs: ProductJob[] = [];

  for (const product of products) {
    if (wanted.size > 0 && !wanted.has(product.id)) continue;
    const registered = Boolean(assets[product.id]);
    const replaceable = options.force && generated.has(product.id);
    if (registered && !replaceable) continue;
    jobs.push({
      productId: product.id,
      title: product.title,
      description: product.description,
      category: product.category,
      aspect: aspectFor(product.category),
      outputSrc: outputSrcForProduct(product.id),
    });
  }

  return jobs;
}

/** Spec section 6, verbatim; the model never sees an id or a Scene enum. */
export function buildProductPrompt(
  job: Pick<ProductJob, "title" | "description">,
  options: { angleReference?: boolean } = {},
): string {
  const angle = options.angleReference
    ? [
        "Match the camera angle of the attached reference image exactly: the",
        "same camera height slightly above eye level looking gently down, and",
        "the same three-quarter turn with the product's front toward the",
        "viewer's right so its viewer-left end is visible. The reference is",
        "only for the angle; do not copy its design, colour, or material.",
      ]
    : ["Three-quarter view turned to the viewer's right,"];
  return [
    `Product photography of ${job.title}: ${job.description}`,
    ...angle,
    "the whole product visible with a small margin, standing on an invisible",
    "floor, pure white studio background, no props, no text, no shadow, no",
    "reflections.",
  ].join(" ");
}

function channelsAt(
  rgba: Uint8Array,
  index: number,
): readonly [number, number, number] {
  const at = index * 4;
  return [rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0];
}

function withinTolerance(
  pixel: readonly [number, number, number],
  sample: readonly [number, number, number],
): boolean {
  return (
    Math.abs(pixel[0] - sample[0]) <= BACKGROUND_TOLERANCE &&
    Math.abs(pixel[1] - sample[1]) <= BACKGROUND_TOLERANCE &&
    Math.abs(pixel[2] - sample[2]) <= BACKGROUND_TOLERANCE
  );
}

/**
 * Turns the model's white studio background transparent without touching the
 * whites inside the product: the four corners give the background colour, a
 * 4-connected flood fill starting at every border pixel spreads only through
 * pixels within tolerance of one of them, and an enclosed white is never
 * reached. The alpha edge is then feathered by one pixel on the product side
 * only, so no cleared pixel is ever given a white halo. The input is not
 * mutated.
 */
export interface RemoveBackgroundOptions {
  /**
   * Also clear background-coloured regions that the border flood cannot reach:
   * the gaps between the shelves of a bookcase are enclosed by its frame in 2D
   * but are still the studio wall behind it. Only regions of at least
   * `enclosedMinimumPixels` are cleared so small pale details survive.
   */
  enclosed?: boolean;
  enclosedMinimumPixels?: number;
}

export const ENCLOSED_BACKGROUND_MINIMUM_PIXELS = 2000;

export function removeBackground(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: RemoveBackgroundOptions = {},
): Uint8Array {
  const out = new Uint8Array(rgba);
  if (width <= 0 || height <= 0) return out;

  const samples = [
    channelsAt(rgba, 0),
    channelsAt(rgba, width - 1),
    channelsAt(rgba, (height - 1) * width),
    channelsAt(rgba, height * width - 1),
  ];
  const isBackground = (index: number): boolean => {
    const pixel = channelsAt(rgba, index);
    return samples.some((sample) => withinTolerance(pixel, sample));
  };

  const cleared = new Uint8Array(width * height);
  const queue: number[] = [];
  const visit = (index: number): void => {
    if (cleared[index] === 1 || !isBackground(index)) return;
    cleared[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    visit(y * width);
    visit(y * width + width - 1);
  }

  while (queue.length > 0) {
    const index = queue.pop()!;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y < height - 1) visit(index + width);
  }

  if (options.enclosed) {
    const minimum =
      options.enclosedMinimumPixels ?? ENCLOSED_BACKGROUND_MINIMUM_PIXELS;
    const seen = new Uint8Array(width * height);
    for (let start = 0; start < seen.length; start += 1) {
      if (seen[start] === 1 || cleared[start] === 1 || !isBackground(start)) {
        continue;
      }
      // Collect one enclosed background-coloured component at a time.
      const component: number[] = [];
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const index = stack.pop()!;
        component.push(index);
        const x = index % width;
        const y = (index - x) / width;
        const neighbours = [
          x > 0 ? index - 1 : -1,
          x < width - 1 ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y < height - 1 ? index + width : -1,
        ];
        for (const next of neighbours) {
          if (next < 0 || seen[next] === 1 || cleared[next] === 1) continue;
          if (!isBackground(next)) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      if (component.length >= minimum) {
        for (const index of component) cleared[index] = 1;
      }
    }
  }

  const alpha = new Uint8Array(width * height);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = cleared[index] === 1 ? 0 : (rgba[index * 4 + 3] ?? 0);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (cleared[index] === 1) {
        out[index * 4 + 3] = 0;
        continue;
      }
      let total = 0;
      let count = 0;
      let onEdge = false;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = ny * width + nx;
          if (cleared[neighbour] === 1) onEdge = true;
          total += alpha[neighbour]!;
          count += 1;
        }
      }
      out[index * 4 + 3] = onEdge ? Math.round(total / count) : alpha[index]!;
    }
  }

  return out;
}

function round(value: number): number {
  const factor = 10 ** QUAD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * A default floor quad for a rug this pipeline generated: the alpha bounding
 * box, with the back edge pulled in by a tenth of its width so the far side
 * reads as perspective. Recorded with `quadSource: "bbox"` — it is a starting
 * point a human can replace with a measured quad, not a calibration.
 */
export function quadFromAlpha(
  rgba: Uint8Array,
  width: number,
  height: number,
): NormalizedQuad | null {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3] ?? 0;
      if (alpha < ALPHA_THRESHOLD) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (bottom < 0) return null;

  const x0 = left / width;
  const x1 = (right + 1) / width;
  const y0 = top / height;
  const y1 = (bottom + 1) / height;
  const inset = (x1 - x0) * BACK_EDGE_INSET;

  return [
    { x: round(x0 + inset), y: round(y0) },
    { x: round(x1 - inset), y: round(y0) },
    { x: round(x1), y: round(y1) },
    { x: round(x0), y: round(y1) },
  ];
}

/** Later entries win; the result is sorted by product id. */
export function mergeProductManifest(
  manifest: readonly GeneratedProductAsset[],
  entries: readonly GeneratedProductAsset[],
): GeneratedProductAsset[] {
  const merged = new Map<string, GeneratedProductAsset>();
  for (const entry of [...manifest, ...entries]) merged.set(entry.id, entry);
  return [...merged.values()].sort((first, second) =>
    first.id.localeCompare(second.id),
  );
}

/** The `src/features/photo/photo-products.generated.ts` module the shell writes. */
export function renderProductManifestModule(
  entries: readonly GeneratedProductAsset[],
): string {
  return `${MANIFEST_MODULE_HEADER}
export const GENERATED_PRODUCT_ASSETS: GeneratedProductAsset[] = ${JSON.stringify(
    entries,
    null,
    2,
  )};
`;
}

/**
 * Inverse of `renderProductManifestModule`: reads back what a run wrote and
 * validates it, so tooling and tests never re-implement the wrapper.
 */
export function parseProductManifestModule(
  source: string,
): GeneratedProductAsset[] {
  const start = source.indexOf("= ");
  const end = source.lastIndexOf(";");
  if (start < 0 || end <= start) {
    throw new Error("not a generated product manifest module");
  }
  const parsed: unknown = JSON.parse(source.slice(start + 2, end));
  if (!Array.isArray(parsed)) {
    throw new Error("not a generated product manifest module");
  }
  return parsed.map((entry) => GeneratedProductAssetSchema.parse(entry));
}
