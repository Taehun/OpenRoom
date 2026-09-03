/**
 * Pure core of the offline view pipeline (`pnpm assets:views`): argument
 * parsing, job planning, prompt and multipart construction, anchor measurement
 * and manifest merging. No I/O, no env, no network — `generate-views.ts` is the
 * shell that supplies all of those. The app never imports either file.
 */
import {
  PHOTO_VIEW_NAMES,
  type PhotoViewName,
} from "../../src/features/photo/photo-facing";
import type {
  GeneratedViewEntry,
  GeneratedViewManifest,
  PhotoAssetSet,
  PhotoViewSymmetry,
} from "../../src/features/photo/photo-views";
import type { SceneObjectType } from "../../src/features/scene/scene-schema";

/** Every view the pipeline can generate; `front-quarter` is always photographed. */
export type GeneratedView = Exclude<PhotoViewName, "front-quarter">;

export const GENERATED_VIEW_NAMES: readonly GeneratedView[] = [
  "side",
  "back-quarter",
  "back",
];

export interface ViewJob {
  assetId: string;
  view: GeneratedView;
  referenceSrc: string;
  outputSrc: string;
  category: SceneObjectType;
  landscape: boolean;
}

export interface CliOptions {
  dryRun: boolean;
  force: boolean;
  products: string[];
  views: GeneratedView[];
}

export interface ImageRequestEnv {
  model: string;
  quality: "low" | "medium" | "high";
}

/** Which views a symmetry class needs: a radial asset needs none. */
const VIEWS_BY_SYMMETRY: Readonly<Record<PhotoViewSymmetry, readonly GeneratedView[]>> =
  Object.freeze({
    none: GENERATED_VIEW_NAMES,
    "front-back": ["side"],
    radial: [],
  });

/** Human labels for the prompt; the model never sees a Scene enum. */
const CATEGORY_LABELS: Readonly<Record<SceneObjectType, string>> = Object.freeze({
  sofa: "sofa",
  chair: "armchair",
  coffee_table: "coffee table",
  floor_lamp: "floor lamp",
  plant: "plant",
  rug: "rug",
  unknown: "furniture piece",
});

/** Pixels this opaque or better count as product when measuring the anchor. */
const ALPHA_THRESHOLD = 16;
const ANCHOR_DECIMALS = 4;

const MANIFEST_MODULE_HEADER = [
  'import type { GeneratedViewManifest } from "./photo-views";',
  "",
  "/** Written by `pnpm assets:views`; do not edit by hand. */",
].join("\n");

function isGeneratedView(value: string): value is GeneratedView {
  return (GENERATED_VIEW_NAMES as readonly string[]).includes(value);
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    force: false,
    products: [],
    views: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    switch (token) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--product": {
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) {
          throw new Error("--product requires an assetId");
        }
        options.products.push(value);
        index += 1;
        break;
      }
      case "--view": {
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) {
          throw new Error(
            `--view requires one of ${GENERATED_VIEW_NAMES.join(", ")}`,
          );
        }
        if (!isGeneratedView(value)) {
          throw new Error(
            `--view must be one of ${GENERATED_VIEW_NAMES.join(", ")}, got ${value}`,
          );
        }
        options.views.push(value);
        index += 1;
        break;
      }
      default:
        throw new Error(`unknown argument: ${token}`);
    }
  }

  return options;
}

/** `<dir of the reference>/<assetId>--<view>.webp`. */
export function outputSrcFor(
  assetId: string,
  view: GeneratedView,
  referenceSrc: string,
): string {
  const slash = referenceSrc.lastIndexOf("/");
  const directory = slash < 0 ? "" : referenceSrc.slice(0, slash);
  return `${directory}/${assetId}--${view}.webp`;
}

export function planJobs(
  sets: Readonly<Record<string, PhotoAssetSet>>,
  manifest: GeneratedViewManifest,
  options: CliOptions,
): ViewJob[] {
  const existing = new Set(
    manifest.views.map((entry) => `${entry.assetId}/${entry.view}`),
  );
  const wantedProducts = new Set(options.products);
  const wantedViews = new Set<GeneratedView>(options.views);
  const jobs: ViewJob[] = [];

  for (const set of Object.values(sets)) {
    if (wantedProducts.size > 0 && !wantedProducts.has(set.id)) continue;
    const reference = set.views.find((view) => view.view === "front-quarter");
    if (!reference) continue;

    for (const view of VIEWS_BY_SYMMETRY[set.symmetry]) {
      if (wantedViews.size > 0 && !wantedViews.has(view)) continue;
      if (!options.force && existing.has(`${set.id}/${view}`)) continue;
      jobs.push({
        assetId: set.id,
        view,
        referenceSrc: reference.src,
        outputSrc: outputSrcFor(set.id, view, reference.src),
        category: set.type,
        landscape: reference.intrinsicWidth >= reference.intrinsicHeight,
      });
    }
  }

  return jobs;
}

function viewDescription(view: GeneratedView, label: string): string {
  switch (view) {
    case "side":
      return `its right side, a pure 90-degree profile with the front of the ${label} pointing to the viewer's right`;
    case "back-quarter":
      return "behind and to the right, a three-quarter rear view with the back facing the camera and the front pointing away to the viewer's right";
    case "back":
      return `directly behind, showing only the back of the ${label}`;
  }
}

export function buildPrompt(job: ViewJob): string {
  const label = CATEGORY_LABELS[job.category];
  return [
    `Product photography of the exact same ${label} shown in the reference image,`,
    `viewed from ${viewDescription(job.view, label)}.`,
    "Keep the identical design, materials, colors, proportions, and lighting.",
    "Same camera height and lens, centered, the whole product visible with a",
    "small margin, standing on an invisible floor. Isolated on a fully",
    "transparent background with no shadow, no floor, no props, no text.",
  ].join(" ");
}

/** The text fields of the `images/edits` multipart body; the file is the shell's. */
export function multipartFields(
  job: ViewJob,
  env: ImageRequestEnv,
): Array<[string, string]> {
  return [
    ["model", env.model],
    ["prompt", buildPrompt(job)],
    ["background", "transparent"],
    ["output_format", "webp"],
    ["output_compression", "100"],
    ["size", job.landscape ? "1536x1024" : "1024x1536"],
    ["quality", env.quality],
    ["input_fidelity", "high"],
    ["n", "1"],
  ];
}

function round(value: number): number {
  const factor = 10 ** ANCHOR_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * The floor anchor of a cutout: horizontally the centre of the product's
 * bounding box, vertically its lowest opaque row. Null when the image carries
 * no product pixel at all, which fails the job rather than writing a guess.
 */
export function measureAnchor(
  rgba: Uint8Array,
  width: number,
  height: number,
): { anchorX: number; anchorY: number } | null {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3] ?? 0;
      if (alpha < ALPHA_THRESHOLD) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
    }
  }

  if (bottom < 0) return null;
  return {
    anchorX: round((left + right + 1) / 2 / width),
    anchorY: round((bottom + 1) / height),
  };
}

function viewOrder(view: GeneratedView): number {
  return PHOTO_VIEW_NAMES.indexOf(view);
}

/** Later entries win; the result is sorted by assetId then canonical view order. */
export function mergeManifest(
  manifest: GeneratedViewManifest,
  entries: GeneratedViewEntry[],
): GeneratedViewManifest {
  const merged = new Map<string, GeneratedViewEntry>();
  for (const entry of [...manifest.views, ...entries]) {
    merged.set(`${entry.assetId}/${entry.view}`, entry);
  }
  const views = [...merged.values()].sort(
    (first, second) =>
      first.assetId.localeCompare(second.assetId) ||
      viewOrder(first.view) - viewOrder(second.view),
  );
  return { version: 1, views };
}

/** The `src/features/photo/photo-views.generated.ts` module the shell writes. */
export function renderManifestModule(manifest: GeneratedViewManifest): string {
  return `${MANIFEST_MODULE_HEADER}
export const GENERATED_VIEW_MANIFEST: GeneratedViewManifest = ${JSON.stringify(
    manifest,
    null,
    2,
  )};
`;
}
