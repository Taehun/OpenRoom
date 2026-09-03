/**
 * `pnpm assets:views` — the developer-run pipeline that fills
 * `src/features/photo/photo-views.generated.ts` with the views the catalog
 * lacks. This is the only place in the project that calls an image model.
 *
 * The app never imports this file, CI never runs it, tests never let it touch
 * the network, and the key is read from the environment only and never logged.
 * Everything pure lives in `view-jobs.ts`; this module is the I/O shell: env,
 * `fetch`, `sharp` decode/encode, and file writes.
 */
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  GeneratedViewManifestSchema,
  PHOTO_ASSET_SETS,
  type GeneratedViewEntry,
  type GeneratedViewManifest,
  type PhotoAssetSet,
} from "../../src/features/photo/photo-views";
import { GENERATED_VIEW_MANIFEST } from "../../src/features/photo/photo-views.generated";
import {
  measureAnchor,
  mergeManifest,
  multipartFields,
  parseArgs,
  planJobs,
  renderManifestModule,
  type ImageRequestEnv,
  type ViewJob,
} from "./view-jobs";

const IMAGES_EDITS_URL = "https://api.openai.com/v1/images/edits";
const MANIFEST_PATH = "src/features/photo/photo-views.generated.ts";
const PUBLIC_DIR = "public";
const DEFAULT_MODEL = "gpt-image-1";
const QUALITIES = ["low", "medium", "high"] as const;
const DEFAULT_QUALITY: ImageRequestEnv["quality"] = "high";
/** 429 and 5xx are retried after these waits; anything else aborts the run. */
const RETRY_WAITS_MS = [2_000, 4_000, 8_000] as const;

export interface DecodedImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

export interface GenerateViewsDeps {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof globalThis.fetch;
  log?: (message: string) => void;
  readFile?: (path: string) => Promise<Uint8Array>;
  writeFile?: (path: string, data: Uint8Array | string) => Promise<void>;
  decode?: (bytes: Uint8Array) => Promise<DecodedImage>;
  encode?: (bytes: Uint8Array) => Promise<Uint8Array>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  sets?: Readonly<Record<string, PhotoAssetSet>>;
  manifest?: GeneratedViewManifest;
}

export interface GenerateViewsResult {
  exitCode: number;
}

async function defaultReadFile(path: string): Promise<Uint8Array> {
  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(path));
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

async function defaultEncode(bytes: Uint8Array): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  return new Uint8Array(
    await sharp(Buffer.from(bytes)).webp({ lossless: true }).toBuffer(),
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function readQuality(
  value: string | undefined,
): ImageRequestEnv["quality"] | null {
  if (value === undefined || value === "") return DEFAULT_QUALITY;
  return (QUALITIES as readonly string[]).includes(value)
    ? (value as ImageRequestEnv["quality"])
    : null;
}

function localPathOf(src: string): string {
  return join(PUBLIC_DIR, src.replace(/^\//, ""));
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

interface EditResponse {
  data?: { b64_json?: string }[];
}

/**
 * One `images/edits` call, retried on 429/5xx. The key travels in the header
 * only; failures report the status and the model's message, never the request.
 */
async function requestView(
  job: ViewJob,
  reference: Uint8Array,
  request: ImageRequestEnv,
  key: string,
  deps: Required<Pick<GenerateViewsDeps, "fetch" | "log" | "sleep">>,
): Promise<Uint8Array> {
  for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt += 1) {
    const body = new FormData();
    for (const [name, value] of multipartFields(job, request)) {
      body.append(name, value);
    }
    body.append(
      "image",
      // Copied so the Blob owns a plain ArrayBuffer, whatever the reader returned.
      new Blob([new Uint8Array(reference)], { type: "image/webp" }),
      basename(job.referenceSrc),
    );

    const response = await deps.fetch(IMAGES_EDITS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      const wait = RETRY_WAITS_MS[attempt];
      if (isRetryable(response.status) && wait !== undefined) {
        deps.log(
          `[views] ${job.assetId}/${job.view} HTTP ${response.status}, retrying in ${wait / 1000}s`,
        );
        await deps.sleep(wait);
        continue;
      }
      throw new Error(`HTTP ${response.status} from images/edits: ${detail}`);
    }

    const payload = (await response.json()) as EditResponse;
    const base64 = payload.data?.[0]?.b64_json;
    if (!base64) throw new Error("images/edits returned no image data");
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  throw new Error("images/edits exhausted its retries");
}

export async function runGenerateViews(
  deps: GenerateViewsDeps,
): Promise<GenerateViewsResult> {
  const log = deps.log ?? ((message: string) => console.log(message));
  const readFile = deps.readFile ?? defaultReadFile;
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const decode = deps.decode ?? defaultDecode;
  const encode = deps.encode ?? defaultEncode;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const sets = deps.sets ?? PHOTO_ASSET_SETS;

  let options;
  try {
    options = parseArgs(deps.argv);
  } catch (error) {
    log(`[views] ${error instanceof Error ? error.message : String(error)}`);
    log(
      "[views] usage: pnpm assets:views [--dry-run] [--product <assetId>]... [--view <name>]... [--force]",
    );
    return { exitCode: 2 };
  }

  let manifest: GeneratedViewManifest;
  try {
    manifest = GeneratedViewManifestSchema.parse(
      deps.manifest ?? GENERATED_VIEW_MANIFEST,
    );
  } catch (error) {
    log(
      `[views] ${MANIFEST_PATH} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { exitCode: 2 };
  }

  let jobs;
  try {
    jobs = planJobs(sets, manifest, options);
  } catch (error) {
    log(`[views] ${error instanceof Error ? error.message : String(error)}`);
    return { exitCode: 2 };
  }
  log(`[views] planned ${jobs.length} job(s)`);
  for (const job of jobs) {
    log(`[views] plan ${job.assetId}/${job.view} -> ${job.outputSrc}`);
  }

  if (options.dryRun) {
    log("[views] dry run: no request was made and no file was written");
    return { exitCode: 0 };
  }

  const key = deps.env.OPENAI_API_KEY?.trim();
  if (!key) {
    log(
      "[views] OPENAI_API_KEY is not set. Put it in .env.local (never committed) or run with --dry-run.",
    );
    return { exitCode: 2 };
  }

  const quality = readQuality(deps.env.OPENINTERIOR_IMAGE_QUALITY);
  if (quality === null) {
    log(
      `[views] OPENINTERIOR_IMAGE_QUALITY must be one of ${QUALITIES.join(", ")}`,
    );
    return { exitCode: 2 };
  }
  const request: ImageRequestEnv = {
    model: deps.env.OPENINTERIOR_IMAGE_MODEL?.trim() || DEFAULT_MODEL,
    quality,
  };

  if (jobs.length === 0) {
    log("[views] nothing to generate; every registered view already exists");
    return { exitCode: 0 };
  }
  log(`[views] model ${request.model}, quality ${request.quality}`);

  const done: GeneratedViewEntry[] = [];
  const writeManifest = async () => {
    const merged = mergeManifest(manifest, done);
    await writeFile(MANIFEST_PATH, renderManifestModule(merged));
  };

  for (const job of jobs) {
    try {
      const reference = await readFile(localPathOf(job.referenceSrc));
      const generated = await requestView(job, reference, request, key, {
        fetch: deps.fetch,
        log,
        sleep,
      });
      const decoded = await decode(generated);
      const anchor = measureAnchor(decoded.rgba, decoded.width, decoded.height);
      if (!anchor) {
        throw new Error("the generated image has no opaque pixel to anchor to");
      }
      await writeFile(localPathOf(job.outputSrc), await encode(generated));
      done.push({
        assetId: job.assetId,
        view: job.view,
        src: job.outputSrc,
        intrinsicWidth: decoded.width,
        intrinsicHeight: decoded.height,
        anchorX: anchor.anchorX,
        anchorY: anchor.anchorY,
        model: request.model,
        generatedAt: now().toISOString(),
      });
      await writeManifest();
      log(
        `[views] ${job.assetId}/${job.view} ok (anchor ${anchor.anchorX.toFixed(2)}, ${anchor.anchorY.toFixed(2)})`,
      );
    } catch (error) {
      log(
        `[views] ${job.assetId}/${job.view} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (done.length > 0) await writeManifest();
      log(`[views] stopped after ${done.length} generated view(s)`);
      return { exitCode: 1 };
    }
  }

  log(`[views] wrote ${done.length} view(s) and ${MANIFEST_PATH}`);
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
  const { exitCode } = await runGenerateViews({
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
      console.error(
        `[views] ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    },
  );
}
