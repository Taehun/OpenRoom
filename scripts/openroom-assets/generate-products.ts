/**
 * `pnpm assets:products` — the developer-run pipeline that photographs the
 * front-quarter cutout of every catalog product that has no registered asset
 * and fills `src/features/photo/photo-products.generated.ts`.
 *
 * Like `generate-views.ts` this is developer-run only: the app never imports
 * it, CI never runs it, tests never let it touch the network, and the key is
 * read from the environment only and never logged. Everything pure lives in
 * `product-jobs.ts`; this module is the I/O shell: env, `fetch` (through an
 * `ImageProvider`), `sharp` decode/encode, and file writes.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import {
  GeneratedProductAssetSchema,
  PHOTO_ASSETS,
  type GeneratedProductAsset,
  type PhotoAsset,
} from "../../src/features/photo/photo-assets";
import { GENERATED_PRODUCT_ASSETS } from "../../src/features/photo/photo-products.generated";
import {
  buildProductPrompt,
  mergeProductManifest,
  parseProductArgs,
  planProductJobs,
  quadFromAlpha,
  removeBackground,
  renderProductManifestModule,
  type CatalogProduct,
} from "./product-jobs";
import { modelFor, selectProvider, type ImageReference } from "./providers";
import { measureAnchor } from "./view-jobs";

const MANIFEST_PATH = "src/features/photo/photo-products.generated.ts";
const PUBLIC_DIR = "public";
const QUALITIES = ["low", "medium", "high"] as const;
type Quality = (typeof QUALITIES)[number];
const DEFAULT_QUALITY: Quality = "high";

export interface DecodedImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

export interface GenerateProductsDeps {
  /** Reads a registered cutout for --angle-reference; defaults to node:fs. */
  readFile?: (path: string) => Promise<Uint8Array>;
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof globalThis.fetch;
  log?: (message: string) => void;
  writeFile?: (path: string, data: Uint8Array | string) => Promise<void>;
  decode?: (bytes: Uint8Array) => Promise<DecodedImage>;
  /** Encodes the cleaned RGBA buffer, not the model's bytes: alpha changed. */
  encode?: (
    rgba: Uint8Array,
    width: number,
    height: number,
  ) => Promise<Uint8Array>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  products?: readonly CatalogProduct[];
  assets?: Readonly<Record<string, PhotoAsset>>;
  manifest?: readonly GeneratedProductAsset[];
}

export interface GenerateProductsResult {
  exitCode: number;
}

async function defaultWriteFile(
  path: string,
  data: Uint8Array | string,
): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, data);
}

/** `sharp` is a devDependency loaded lazily, so no test ever pulls it in. */
async function defaultDecode(bytes: Uint8Array): Promise<DecodedImage> {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(Buffer.from(bytes))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8Array(data), width: info.width, height: info.height };
}

async function defaultEncode(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  return new Uint8Array(
    await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } })
      .webp({ lossless: true })
      .toBuffer(),
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function readQuality(value: string | undefined): Quality | null {
  if (value === undefined || value === "") return DEFAULT_QUALITY;
  return (QUALITIES as readonly string[]).includes(value)
    ? (value as Quality)
    : null;
}

function localPathOf(src: string): string {
  return join(PUBLIC_DIR, src.replace(/^\//, ""));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runGenerateProducts(
  deps: GenerateProductsDeps,
): Promise<GenerateProductsResult> {
  const log = deps.log ?? ((message: string) => console.log(message));
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const decode = deps.decode ?? defaultDecode;
  const encode = deps.encode ?? defaultEncode;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const products = deps.products ?? DEMO_PRODUCTS;
  const assets = deps.assets ?? PHOTO_ASSETS;

  let options;
  try {
    options = parseProductArgs(deps.argv);
  } catch (error) {
    log(`[products] ${messageOf(error)}`);
    log(
      "[products] usage: pnpm assets:products [--dry-run] [--product <id>]... [--force]",
    );
    return { exitCode: 2 };
  }

  let manifest: GeneratedProductAsset[];
  try {
    manifest = (deps.manifest ?? GENERATED_PRODUCT_ASSETS).map((entry) =>
      GeneratedProductAssetSchema.parse(entry),
    );
  } catch (error) {
    log(`[products] ${MANIFEST_PATH} is invalid: ${messageOf(error)}`);
    return { exitCode: 2 };
  }

  let jobs;
  try {
    jobs = planProductJobs(products, assets, manifest, options);
  } catch (error) {
    log(`[products] ${messageOf(error)}`);
    return { exitCode: 2 };
  }
  log(`[products] planned ${jobs.length} job(s)`);
  for (const job of jobs) {
    log(`[products] plan ${job.productId} (${job.aspect}) -> ${job.outputSrc}`);
  }

  if (options.dryRun) {
    log("[products] dry run: no request was made and no file was written");
    return { exitCode: 0 };
  }

  let provider;
  try {
    provider = selectProvider(deps.env);
  } catch (error) {
    log(`[products] ${messageOf(error)}`);
    return { exitCode: 2 };
  }
  const key = deps.env[provider.keyEnv]?.trim() ?? "";

  const quality = readQuality(deps.env.OPENROOM_IMAGE_QUALITY);
  if (quality === null) {
    log(
      `[products] OPENROOM_IMAGE_QUALITY must be one of ${QUALITIES.join(", ")}`,
    );
    return { exitCode: 2 };
  }
  const model = modelFor(provider, deps.env);

  if (jobs.length === 0) {
    log("[products] nothing to generate; every product already has a cutout");
    return { exitCode: 0 };
  }
  log(`[products] provider ${provider.name}, model ${model}`);

  const done: GeneratedProductAsset[] = [];
  const writeManifest = async () => {
    await writeFile(
      MANIFEST_PATH,
      renderProductManifestModule(mergeProductManifest(manifest, done)),
    );
  };

  // An angle reference is a registered cutout sent as an image part so every
  // generated product shares its camera pitch and three-quarter turn.
  const readReference =
    deps.readFile ??
    (async (path: string): Promise<Uint8Array> => {
      const { readFile } = await import("node:fs/promises");
      return new Uint8Array(await readFile(path));
    });
  let angleReference: ImageReference | null = null;
  if (options.angleReference !== null) {
    const asset = PHOTO_ASSETS[options.angleReference];
    if (!asset) {
      log(`[products] unknown --angle-reference ${options.angleReference}`);
      return { exitCode: 2 };
    }
    angleReference = {
      bytes: await readReference(localPathOf(asset.src)),
      mimeType: "image/webp",
      filename: `${options.angleReference}.webp`,
    };
  }

  for (const job of jobs) {
    try {
      const generated = await provider.generate(
        {
          prompt: buildProductPrompt(job, {
            angleReference: angleReference !== null,
          }),
          aspect: job.aspect,
          model,
          quality,
          ...(angleReference ? { reference: angleReference } : {}),
        },
        {
          fetch: deps.fetch,
          key,
          log,
          sleep,
          label: `[products] ${job.productId}`,
        },
      );
      const decoded = await decode(generated);
      const cutout = removeBackground(decoded.rgba, decoded.width, decoded.height, {
        // A bookcase's shelf gaps are enclosed by its frame but are still wall.
        enclosed: job.category === "bookshelf",
      });
      const anchor = measureAnchor(cutout, decoded.width, decoded.height);
      if (!anchor) {
        throw new Error(
          "nothing survived the background removal; the model returned no product",
        );
      }
      const quad =
        job.category === "rug"
          ? quadFromAlpha(cutout, decoded.width, decoded.height)
          : null;

      await writeFile(
        localPathOf(job.outputSrc),
        await encode(cutout, decoded.width, decoded.height),
      );
      done.push({
        id: job.productId,
        src: job.outputSrc,
        intrinsicWidth: decoded.width,
        intrinsicHeight: decoded.height,
        anchorX: anchor.anchorX,
        anchorY: anchor.anchorY,
        ...(quad ? { floorQuad: quad, quadSource: "bbox" as const } : {}),
        provider: provider.name,
        model,
        generatedAt: now().toISOString(),
      });
      await writeManifest();
      log(
        `[products] ${job.productId} ok (anchor ${anchor.anchorX.toFixed(2)}, ${anchor.anchorY.toFixed(2)})`,
      );
    } catch (error) {
      log(`[products] ${job.productId} failed: ${messageOf(error)}`);
      if (done.length > 0) await writeManifest();
      log(`[products] stopped after ${done.length} generated cutout(s)`);
      return { exitCode: 1 };
    }
  }

  log(`[products] wrote ${done.length} cutout(s) and ${MANIFEST_PATH}`);
  return { exitCode: 0 };
}

/** Reads `.env.local` only, and only when it exists; no other env file is touched. */
function loadLocalEnv(): void {
  try {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  } catch {
    // A missing or unreadable .env.local is fine: the environment may carry the key.
  }
}

function isCliEntry(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return resolve(invoked) === fileURLToPath(import.meta.url);
}

async function main(): Promise<number> {
  loadLocalEnv();
  const { exitCode } = await runGenerateProducts({
    argv: process.argv.slice(2),
    env: process.env,
    fetch: globalThis.fetch,
  });
  return exitCode;
}

if (isCliEntry()) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      console.error(`[products] ${messageOf(error)}`);
      process.exitCode = 1;
    },
  );
}
