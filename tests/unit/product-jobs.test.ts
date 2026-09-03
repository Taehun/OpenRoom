import { describe, expect, it, vi } from "vitest";

import {
  aspectFor,
  buildProductPrompt,
  mergeProductManifest,
  outputSrcForProduct,
  parseProductArgs,
  parseProductManifestModule,
  planProductJobs,
  quadFromAlpha,
  removeBackground,
  renderProductManifestModule,
  type CatalogProduct,
} from "../../scripts/openroom-assets/product-jobs";
import {
  geminiProvider,
  geminiRequestBody,
  openaiProvider,
  selectProvider,
} from "../../scripts/openroom-assets/providers";
import { runGenerateProducts } from "../../scripts/openroom-assets/generate-products";
import { runGenerateViews } from "../../scripts/openroom-assets/generate-views";
import { parseManifestModule } from "../../scripts/openroom-assets/view-jobs";
import { FRONT_VECTORS } from "../../src/features/photo/photo-facing";
import type { PhotoAssetSet } from "../../src/features/photo/photo-views";
import {
  GeneratedProductAssetSchema,
  PHOTO_ASSETS,
  productsWithoutAssets,
  type PhotoAsset,
} from "../../src/features/photo/photo-assets";
import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";

/**
 * A fixture catalog, not the live one: Task 1 and Task 2 are editing the real
 * tables concurrently, and these tests pin the pipeline, not the catalog.
 */
const CATALOG: readonly CatalogProduct[] = [
  {
    id: "fixture-sofa",
    title: "Fixture Sofa",
    category: "sofa",
    description: "A low fixture sofa.",
  },
  {
    id: "fixture-side-table",
    title: "Fixture Side Table",
    category: "side_table",
    description: "A small round side table.",
  },
  {
    id: "fixture-bookshelf",
    title: "Fixture Bookshelf",
    category: "bookshelf",
    description: "An open ash bookshelf.",
  },
  {
    id: "fixture-rug",
    title: "Fixture Rug",
    category: "rug",
    description: "A flat runner rug.",
  },
];

const REGISTERED: Readonly<Record<string, PhotoAsset>> = {
  "fixture-sofa": {
    id: "fixture-sofa",
    src: "/demo/photo/products/fixture-sofa.webp",
    intrinsicWidth: 1536,
    intrinsicHeight: 1024,
    anchorX: 0.5,
    anchorY: 0.9,
  },
};

const GENERATED_ENTRY = {
  id: "fixture-side-table",
  src: "/demo/photo/products/fixture-side-table.webp",
  intrinsicWidth: 848,
  intrinsicHeight: 1264,
  anchorX: 0.5,
  anchorY: 0.98,
  provider: "gemini",
  model: "gemini-3.1-flash-image",
  generatedAt: "2026-09-04T12:00:00.000Z",
} as const;

/**
 * A `size`×`size` white field with an opaque red block inset by `inset`, and a
 * single white pixel inside that block that the flood fill must never reach.
 */
function studioBuffer(size: number, inset: number, hole: [number, number]) {
  const rgba = new Uint8Array(size * size * 4);
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    const at = (y * size + x) * 4;
    rgba[at] = r;
    rgba[at + 1] = g;
    rgba[at + 2] = b;
    rgba[at + 3] = 255;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) put(x, y, 255, 255, 255);
  }
  for (let y = inset; y < size - inset; y += 1) {
    for (let x = inset; x < size - inset; x += 1) put(x, y, 200, 30, 30);
  }
  put(hole[0], hole[1], 255, 255, 255);
  return rgba;
}

const alphaAt = (rgba: Uint8Array, size: number, x: number, y: number) =>
  rgba[(y * size + x) * 4 + 3]!;

describe("product jobs", () => {
  it("plans one job for every catalog product without a registered asset", () => {
    const jobs = planProductJobs(CATALOG, REGISTERED, [], parseProductArgs([]));
    expect(jobs.map((job) => job.productId)).toEqual([
      "fixture-side-table",
      "fixture-bookshelf",
      "fixture-rug",
    ]);
    expect(jobs[0]).toMatchObject({
      title: "Fixture Side Table",
      category: "side_table",
      aspect: "2:3",
      outputSrc: "/demo/photo/products/fixture-side-table.webp",
    });
    expect(jobs[2]).toMatchObject({ category: "rug", aspect: "3:2" });
  });

  it("skips a product the manifest already generated unless --force", () => {
    const assets = { ...REGISTERED, "fixture-side-table": { ...REGISTERED["fixture-sofa"]! } };
    expect(
      planProductJobs(CATALOG, assets, [GENERATED_ENTRY], parseProductArgs([])).map(
        (job) => job.productId,
      ),
    ).toEqual(["fixture-bookshelf", "fixture-rug"]);
    expect(
      planProductJobs(CATALOG, assets, [GENERATED_ENTRY], parseProductArgs(["--force"])).map(
        (job) => job.productId,
      ),
    ).toEqual(["fixture-side-table", "fixture-bookshelf", "fixture-rug"]);
  });

  it("never regenerates a hand-registered cutout, even with --force", () => {
    expect(
      planProductJobs(CATALOG, REGISTERED, [], parseProductArgs(["--force"])).map(
        (job) => job.productId,
      ),
    ).not.toContain("fixture-sofa");
  });

  it("filters by --product and rejects an id outside the catalog", () => {
    expect(
      planProductJobs(
        CATALOG,
        REGISTERED,
        [],
        parseProductArgs(["--product", "fixture-rug"]),
      ).map((job) => job.productId),
    ).toEqual(["fixture-rug"]);
    expect(() =>
      planProductJobs(
        CATALOG,
        REGISTERED,
        [],
        parseProductArgs(["--product", "no-such-product"]),
      ),
    ).toThrow(/no-such-product/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseProductArgs(["--view", "side"])).toThrow(/unknown/i);
    expect(() => parseProductArgs(["--product"])).toThrow(/--product/);
    expect(parseProductArgs(["--dry-run", "--force"])).toEqual({
      dryRun: true,
      force: true,
      products: [],
    });
  });

  it("maps wide categories to 3:2 and tall ones to 2:3, defaulting to 3:2", () => {
    for (const category of ["sofa", "coffee_table", "rug", "bookshelf", "chair"]) {
      expect(aspectFor(category)).toBe("3:2");
    }
    for (const category of ["floor_lamp", "plant", "side_table"]) {
      expect(aspectFor(category)).toBe("2:3");
    }
    expect(aspectFor("unknown")).toBe("3:2");
  });

  it("names the output beside the other product cutouts", () => {
    expect(outputSrcForProduct("fixture-rug")).toBe(
      "/demo/photo/products/fixture-rug.webp",
    );
  });

  it("builds the spec prompt from the product title and description", () => {
    const job = planProductJobs(
      CATALOG,
      REGISTERED,
      [],
      parseProductArgs(["--product", "fixture-bookshelf"]),
    )[0]!;
    expect(buildProductPrompt(job)).toBe(
      "Product photography of Fixture Bookshelf: An open ash bookshelf. " +
        "Three-quarter view turned to the viewer's right, the whole product " +
        "visible with a small margin, standing on an invisible floor, pure " +
        "white studio background, no props, no text, no shadow, no reflections.",
    );
  });
});

describe("gemini request", () => {
  it("builds the verified generateContent body", () => {
    expect(geminiRequestBody({ prompt: "a chair", aspect: "2:3" })).toEqual({
      contents: [{ parts: [{ text: "a chair" }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "2:3" },
      },
    });
  });

  it("appends a reference image as an inlineData part", () => {
    const body = geminiRequestBody({
      prompt: "same sofa from the side",
      aspect: "3:2",
      reference: {
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/webp",
        filename: "sofa.webp",
      },
    });
    expect(body.contents[0]!.parts[1]).toEqual({
      inlineData: {
        mimeType: "image/webp",
        data: Buffer.from([1, 2, 3]).toString("base64"),
      },
    });
  });

  it("posts to generateContent with the key in x-goog-api-key only", async () => {
    const png = Buffer.from("pretend-jpeg-bytes").toString("base64");
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { text: "here you go" },
                { inlineData: { mimeType: "image/jpeg", data: png } },
              ],
            },
          },
        ],
      }),
      text: async () => "",
    } as unknown as Response);

    const bytes = await geminiProvider.generate(
      { prompt: "a lamp", aspect: "2:3", model: "gemini-3.1-flash-image", quality: "high" },
      {
        fetch: fetch as unknown as typeof globalThis.fetch,
        key: "gemini-secret",
        log: vi.fn(),
        sleep: vi.fn(async () => {}),
        label: "[products] fixture-floor-lamp",
      },
    );

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent",
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "x-goog-api-key": "gemini-secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual(
      geminiRequestBody({ prompt: "a lamp", aspect: "2:3" }),
    );
    expect(Buffer.from(bytes).toString()).toBe("pretend-jpeg-bytes");
  });
});

describe("provider selection", () => {
  it("defaults to gemini when only GEMINI_API_KEY is set", () => {
    expect(selectProvider({ GEMINI_API_KEY: "g" }).name).toBe("gemini");
  });

  it("uses openai when OPENAI_API_KEY is set", () => {
    expect(selectProvider({ OPENAI_API_KEY: "o" }).name).toBe("openai");
    expect(selectProvider({ OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" }).name).toBe(
      "openai",
    );
  });

  it("honours an explicit OPENROOM_IMAGE_PROVIDER override", () => {
    expect(
      selectProvider({
        OPENROOM_IMAGE_PROVIDER: "gemini",
        GEMINI_API_KEY: "g",
        OPENAI_API_KEY: "o",
      }).name,
    ).toBe("gemini");
    expect(() =>
      selectProvider({ OPENROOM_IMAGE_PROVIDER: "gemini", OPENAI_API_KEY: "o" }),
    ).toThrow(/GEMINI_API_KEY/);
    expect(() => selectProvider({ OPENROOM_IMAGE_PROVIDER: "midjourney" })).toThrow(
      /OPENROOM_IMAGE_PROVIDER/,
    );
  });

  it("throws when no key is set at all, naming both variables", () => {
    expect(() => selectProvider({})).toThrow(/GEMINI_API_KEY/);
    expect(() => selectProvider({})).toThrow(/OPENAI_API_KEY/);
  });

  it("keeps the model env name and default per provider", () => {
    expect(openaiProvider.defaultModel).toBe("gpt-image-1");
    expect(openaiProvider.modelEnv).toBe("OPENROOM_IMAGE_MODEL");
    expect(geminiProvider.defaultModel).toBe("gemini-3.1-flash-image");
    expect(geminiProvider.modelEnv).toBe("OPENROOM_IMAGE_MODEL_GEMINI");
  });
});

describe("background removal", () => {
  it("clears the border-connected white and keeps an enclosed white pixel", () => {
    const size = 12;
    const rgba = studioBuffer(size, 3, [5, 5]);
    const out = removeBackground(rgba, size, size);

    // The input is untouched: the pure core copies.
    expect(alphaAt(rgba, size, 0, 0)).toBe(255);
    // Every border pixel and the field around the block is gone.
    expect(alphaAt(out, size, 0, 0)).toBe(0);
    expect(alphaAt(out, size, 11, 11)).toBe(0);
    expect(alphaAt(out, size, 1, 6)).toBe(0);
    // The enclosed white pixel survives at full opacity.
    expect(alphaAt(out, size, 5, 5)).toBe(255);
    // The block's interior stays opaque, its rim is feathered.
    expect(alphaAt(out, size, 6, 6)).toBe(255);
    const rim = alphaAt(out, size, 3, 3);
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(255);
  });

  it("clears a near-white background within the 18/255 tolerance", () => {
    const size = 8;
    const rgba = studioBuffer(size, 2, [4, 4]);
    // Nudge one border pixel inside the tolerance and one outside it.
    const nudge = (x: number, y: number, value: number) => {
      const at = (y * size + x) * 4;
      rgba[at] = value;
      rgba[at + 1] = value;
      rgba[at + 2] = value;
    };
    nudge(0, 3, 240); // 15 away: still background
    nudge(0, 4, 200); // 55 away: kept
    const out = removeBackground(rgba, size, size);
    expect(alphaAt(out, size, 0, 3)).toBe(0);
    expect(alphaAt(out, size, 0, 4)).toBeGreaterThan(0);
  });

  it("returns an all-transparent buffer for a uniform field", () => {
    const size = 4;
    const rgba = new Uint8Array(size * size * 4).fill(255);
    const out = removeBackground(rgba, size, size);
    expect([...out.filter((_, index) => index % 4 === 3)].every((a) => a === 0)).toBe(
      true,
    );
  });
});

describe("floor quad from alpha", () => {
  it("insets the back edge by 10% of the bounding-box width", () => {
    const width = 10;
    const height = 10;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 2; y <= 7; y += 1) {
      for (let x = 1; x <= 8; x += 1) rgba[(y * width + x) * 4 + 3] = 255;
    }
    // bbox x 0.1..0.9 (width 0.8, inset 0.08), y 0.2..0.8
    expect(quadFromAlpha(rgba, width, height)).toEqual([
      { x: 0.18, y: 0.2 },
      { x: 0.82, y: 0.2 },
      { x: 0.9, y: 0.8 },
      { x: 0.1, y: 0.8 },
    ]);
  });

  it("returns null when nothing is opaque", () => {
    expect(quadFromAlpha(new Uint8Array(64), 4, 4)).toBeNull();
  });
});

describe("product manifest module", () => {
  it("merges by id, sorts, and round trips through the schema", () => {
    const merged = mergeProductManifest([{ ...GENERATED_ENTRY, anchorY: 0.5 }], [
      GENERATED_ENTRY,
      { ...GENERATED_ENTRY, id: "a-first-product" },
    ]);
    expect(merged.map((entry) => entry.id)).toEqual([
      "a-first-product",
      "fixture-side-table",
    ]);
    expect(merged[1]!.anchorY).toBe(0.98);

    const rendered = renderProductManifestModule(merged);
    expect(rendered).toContain(
      'import type { GeneratedProductAsset } from "./photo-assets";',
    );
    expect(rendered).toContain("do not edit by hand");
    expect(rendered).toContain(
      "export const GENERATED_PRODUCT_ASSETS: GeneratedProductAsset[] = [",
    );
    expect(rendered.endsWith(";\n")).toBe(true);
    expect(parseProductManifestModule(rendered)).toEqual(merged);
    expect(merged.map((entry) => GeneratedProductAssetSchema.parse(entry))).toEqual(
      merged,
    );
  });

  it("rejects a module it did not write", () => {
    expect(() => parseProductManifestModule("export const nothing = 1")).toThrow();
    expect(() => parseProductManifestModule("")).toThrow(/manifest module/);
  });
});

describe("photo asset registry", () => {
  it("lists the catalog products that have no asset", () => {
    expect(productsWithoutAssets(CATALOG, REGISTERED).map((p) => p.id)).toEqual([
      "fixture-side-table",
      "fixture-bookshelf",
      "fixture-rug",
    ]);
  });

  it("keeps the 24 hand-registered cutouts and unions the generated ones", () => {
    expect(Object.keys(PHOTO_ASSETS).length).toBeGreaterThanOrEqual(24);
    expect(PHOTO_ASSETS["hinoki-low-sofa"]!.src).toBe(
      "/demo/photo/products/hinoki-low-sofa.webp",
    );
  });
});

describe("generate-products shell", () => {
  const noop = async () => {
    throw new Error("not used in tests");
  };
  const MANIFEST_PATH = "src/features/photo/photo-products.generated.ts";

  function imageResponse(): Response {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: Buffer.from("pretend-jpeg-bytes").toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
      text: async () => "",
    } as unknown as Response;
  }

  function errorResponse(status: number): Response {
    return {
      ok: false,
      status,
      json: async () => ({}),
      text: async () => JSON.stringify({ error: { message: "nope" } }),
    } as unknown as Response;
  }

  /** 12×12 studio frame in, a lossless-WebP stand-in out. */
  function generationDeps(fetch: ReturnType<typeof vi.fn>) {
    const writes = new Map<string, string | number>();
    const sleep = vi.fn(async () => {});
    const log = vi.fn();
    return {
      writes,
      sleep,
      log,
      deps: {
        env: { GEMINI_API_KEY: "gemini-secret-value" },
        fetch: fetch as unknown as typeof globalThis.fetch,
        log,
        sleep,
        products: CATALOG,
        assets: REGISTERED,
        manifest: [],
        writeFile: async (path: string, data: Uint8Array | string) => {
          writes.set(path, typeof data === "string" ? data : data.byteLength);
        },
        decode: async () => ({
          rgba: studioBuffer(12, 3, [5, 5]),
          width: 12,
          height: 12,
        }),
        encode: async () => new Uint8Array([1, 2, 3]),
        now: () => new Date("2026-09-04T12:00:00.000Z"),
      },
    };
  }

  it("lists the plan and exits 0 for --dry-run without touching the network", async () => {
    const fetch = vi.fn();
    const log = vi.fn();
    const writeFile = vi.fn();
    const result = await runGenerateProducts({
      argv: ["--dry-run"],
      env: {},
      fetch: fetch as unknown as typeof globalThis.fetch,
      log,
      products: CATALOG,
      assets: REGISTERED,
      manifest: [],
      writeFile,
      decode: noop,
      encode: noop,
    });
    expect(result).toEqual({ exitCode: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain("3 job(s)");
  });

  it("plans nothing for the live catalog today and never opens a socket", async () => {
    const fetch = vi.fn();
    const log = vi.fn();
    const result = await runGenerateProducts({
      argv: ["--dry-run"],
      env: {},
      fetch: fetch as unknown as typeof globalThis.fetch,
      log,
      writeFile: noop,
      decode: noop,
      encode: noop,
    });
    expect(result).toEqual({ exitCode: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain(
      `${productsWithoutAssets(DEMO_PRODUCTS).length} job(s)`,
    );
  });

  it("exits 2 without any key and never calls fetch", async () => {
    const fetch = vi.fn();
    const log = vi.fn();
    const result = await runGenerateProducts({
      argv: [],
      env: {},
      fetch: fetch as unknown as typeof globalThis.fetch,
      log,
      products: CATALOG,
      assets: REGISTERED,
      manifest: [],
      writeFile: noop,
      decode: noop,
      encode: noop,
    });
    expect(result).toEqual({ exitCode: 2 });
    expect(fetch).not.toHaveBeenCalled();
    const logged = log.mock.calls.flat().join("\n");
    expect(logged).toContain("GEMINI_API_KEY");
    expect(logged).toContain("OPENAI_API_KEY");
  });

  it("exits 2 on a bad argument and never calls fetch", async () => {
    const fetch = vi.fn();
    const result = await runGenerateProducts({
      argv: ["--nope"],
      env: { GEMINI_API_KEY: "g" },
      fetch: fetch as unknown as typeof globalThis.fetch,
      log: vi.fn(),
      products: CATALOG,
      assets: REGISTERED,
      manifest: [],
      writeFile: noop,
      decode: noop,
      encode: noop,
    });
    expect(result).toEqual({ exitCode: 2 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never echoes the key it was given", async () => {
    const fetch = vi.fn().mockResolvedValue(imageResponse());
    const { log, deps } = generationDeps(fetch);
    await runGenerateProducts({ ...deps, argv: [] });
    expect(log.mock.calls.flat().join("\n")).not.toContain("gemini-secret-value");
  });

  it("writes the cutout, the anchor, the rug quad, and the manifest", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValue(imageResponse());
    const { writes, sleep, deps } = generationDeps(fetch);

    const result = await runGenerateProducts({ ...deps, argv: [] });

    expect(result).toEqual({ exitCode: 0 });
    // One retried job plus two clean ones.
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(writes.get("public/demo/photo/products/fixture-rug.webp")).toBe(3);

    const manifest = parseProductManifestModule(writes.get(MANIFEST_PATH) as string);
    expect(manifest.map((entry) => entry.id)).toEqual([
      "fixture-bookshelf",
      "fixture-rug",
      "fixture-side-table",
    ]);
    const rug = manifest.find((entry) => entry.id === "fixture-rug")!;
    expect(rug).toMatchObject({
      src: "/demo/photo/products/fixture-rug.webp",
      intrinsicWidth: 12,
      intrinsicHeight: 12,
      provider: "gemini",
      model: "gemini-3.1-flash-image",
      generatedAt: "2026-09-04T12:00:00.000Z",
      quadSource: "bbox",
    });
    expect(rug.floorQuad).toHaveLength(4);
    // A non-rug carries no quad.
    expect(
      manifest.find((entry) => entry.id === "fixture-bookshelf")!.floorQuad,
    ).toBeUndefined();
    for (const entry of manifest) GeneratedProductAssetSchema.parse(entry);
  });

  it("keeps the completed job and exits 1 when a later one fails outright", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(errorResponse(400));
    const { writes, sleep, deps } = generationDeps(fetch);

    const result = await runGenerateProducts({ ...deps, argv: [] });

    expect(result).toEqual({ exitCode: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
    expect(writes.has("public/demo/photo/products/fixture-side-table.webp")).toBe(true);
    expect(writes.has("public/demo/photo/products/fixture-bookshelf.webp")).toBe(false);
    const manifest = parseProductManifestModule(writes.get(MANIFEST_PATH) as string);
    expect(manifest.map((entry) => entry.id)).toEqual(["fixture-side-table"]);
  });

  it("exhausts three retries on 429 and leaves the manifest untouched", async () => {
    const fetch = vi.fn().mockResolvedValue(errorResponse(429));
    const { writes, sleep, deps } = generationDeps(fetch);

    const result = await runGenerateProducts({
      ...deps,
      argv: ["--product", "fixture-rug"],
    });

    expect(result).toEqual({ exitCode: 1 });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.flat()).toEqual([2000, 4000, 8000]);
    expect(writes.size).toBe(0);
  });
});

describe("generate-views through the provider adapter", () => {
  it("sends the reference cutout as an inlineData part when Gemini is the provider", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: Buffer.from("pretend-view-bytes").toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
      text: async () => "",
    } as unknown as Response);
    const writes = new Map<string, string | number>();

    // A fixture set, so Task 1's symmetry table cannot move this test.
    const sets = {
      "fixture-sofa": {
        id: "fixture-sofa",
        type: "sofa",
        symmetry: "none",
        views: [
          {
            view: "front-quarter",
            frontVector: FRONT_VECTORS["front-quarter"],
            src: "/demo/photo/products/fixture-sofa.webp",
            intrinsicWidth: 1536,
            intrinsicHeight: 1024,
            anchorX: 0.5,
            anchorY: 0.9,
            origin: "photographed",
          },
        ],
      },
    } as const satisfies Record<string, PhotoAssetSet>;

    const result = await runGenerateViews({
      argv: ["--product", "fixture-sofa", "--view", "side"],
      env: { GEMINI_API_KEY: "gemini-secret-value" },
      fetch: fetch as unknown as typeof globalThis.fetch,
      log: vi.fn(),
      sleep: vi.fn(async () => {}),
      sets,
      manifest: { version: 1, views: [] },
      readFile: async () => new Uint8Array([9, 9, 9]),
      writeFile: async (path: string, data: Uint8Array | string) => {
        writes.set(path, typeof data === "string" ? data : data.byteLength);
      },
      decode: async () => ({
        rgba: new Uint8Array([0, 0, 0, 255]),
        width: 1,
        height: 1,
      }),
      encode: async () => new Uint8Array([1, 2, 3]),
      now: () => new Date("2026-09-04T12:00:00.000Z"),
    });

    expect(result).toEqual({ exitCode: 0 });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent",
    );
    expect(init.headers).toEqual({
      "x-goog-api-key": "gemini-secret-value",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(init.body as string) as ReturnType<
      typeof geminiRequestBody
    >;
    expect(body.generationConfig.imageConfig.aspectRatio).toBe("3:2");
    expect(body.contents[0]!.parts[1]).toEqual({
      inlineData: {
        mimeType: "image/webp",
        data: Buffer.from([9, 9, 9]).toString("base64"),
      },
    });

    const manifest = parseManifestModule(
      writes.get("src/features/photo/photo-views.generated.ts") as string,
    );
    expect(manifest.views[0]).toMatchObject({
      assetId: "fixture-sofa",
      view: "side",
      model: "gemini-3.1-flash-image",
    });
  });
});
