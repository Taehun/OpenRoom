import { describe, expect, it, vi } from "vitest";

import {
  buildPrompt,
  measureAnchor,
  mergeManifest,
  multipartFields,
  outputSrcFor,
  parseArgs,
  planJobs,
  renderManifestModule,
} from "../../scripts/openinterior-assets/view-jobs";
import { runGenerateViews } from "../../scripts/openinterior-assets/generate-views";
import {
  GeneratedViewManifestSchema,
  PHOTO_ASSET_SETS,
} from "../../src/features/photo/photo-views";

describe("view jobs", () => {
  it("plans 28 jobs for the demo catalog with an empty manifest", () => {
    const jobs = planJobs(PHOTO_ASSET_SETS, { version: 1, views: [] }, parseArgs([]));
    expect(jobs).toHaveLength(28);
    expect(
      jobs
        .filter((job) => job.category === "coffee_table")
        .every((job) => job.view === "side"),
    ).toBe(true);
    expect(
      jobs.some(
        (job) =>
          job.category === "floor_lamp" ||
          job.category === "plant" ||
          job.category === "rug",
      ),
    ).toBe(false);
  });

  it("skips existing entries unless --force and filters by product and view", () => {
    const entry = {
      assetId: "hinoki-low-sofa",
      view: "side",
      src: "/demo/photo/products/hinoki-low-sofa--side.webp",
      intrinsicWidth: 1536,
      intrinsicHeight: 1024,
      anchorX: 0.5,
      anchorY: 0.9,
      model: "gpt-image-1",
      generatedAt: "2026-09-03T00:00:00.000Z",
    } as const;
    expect(
      planJobs(PHOTO_ASSET_SETS, { version: 1, views: [entry] }, parseArgs([])),
    ).toHaveLength(27);
    expect(
      planJobs(
        PHOTO_ASSET_SETS,
        { version: 1, views: [entry] },
        parseArgs(["--force"]),
      ),
    ).toHaveLength(28);
    expect(
      planJobs(
        PHOTO_ASSET_SETS,
        { version: 1, views: [] },
        parseArgs(["--product", "hinoki-low-sofa", "--view", "back"]),
      ),
    ).toEqual([
      expect.objectContaining({ assetId: "hinoki-low-sofa", view: "back" }),
    ]);
  });

  it("rejects unknown flags and view names", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown/i);
    expect(() => parseArgs(["--view", "front-quarter"])).toThrow(/view/i);
    expect(() => parseArgs(["--product"])).toThrow(/--product/);
  });

  it("names outputs beside the reference", () => {
    expect(
      outputSrcFor("seed-dated-sofa", "back", "/demo/photo/seed/seed-dated-sofa.webp"),
    ).toBe("/demo/photo/seed/seed-dated-sofa--back.webp");
    expect(
      planJobs(
        PHOTO_ASSET_SETS,
        { version: 1, views: [] },
        parseArgs(["--product", "seed-dated-sofa", "--view", "back"]),
      )[0],
    ).toMatchObject({
      referenceSrc: "/demo/photo/seed/seed-dated-sofa.webp",
      outputSrc: "/demo/photo/seed/seed-dated-sofa--back.webp",
      landscape: true,
    });
  });

  it("builds the prompt and multipart fields from the spec", () => {
    const job = planJobs(
      PHOTO_ASSET_SETS,
      { version: 1, views: [] },
      parseArgs(["--product", "ash-lounge-chair", "--view", "side"]),
    )[0]!;
    const prompt = buildPrompt(job);
    expect(prompt).toContain("exact same armchair");
    expect(prompt).toContain("pure 90-degree profile");
    expect(prompt).toContain("fully transparent background");
    expect(
      Object.fromEntries(multipartFields(job, { model: "gpt-image-1", quality: "high" })),
    ).toEqual({
      model: "gpt-image-1",
      prompt,
      background: "transparent",
      output_format: "webp",
      output_compression: "100",
      size: "1536x1024",
      quality: "high",
      input_fidelity: "high",
      n: "1",
    });
  });

  it("describes each view with the human category label", () => {
    const [table] = planJobs(
      PHOTO_ASSET_SETS,
      { version: 1, views: [] },
      parseArgs(["--product", "oak-frame-table"]),
    );
    expect(buildPrompt(table!)).toContain("exact same coffee table");

    const backQuarter = planJobs(
      PHOTO_ASSET_SETS,
      { version: 1, views: [] },
      parseArgs(["--product", "hinoki-low-sofa", "--view", "back-quarter"]),
    )[0]!;
    expect(buildPrompt(backQuarter)).toContain("three-quarter rear view");

    const back = planJobs(
      PHOTO_ASSET_SETS,
      { version: 1, views: [] },
      parseArgs(["--product", "hinoki-low-sofa", "--view", "back"]),
    )[0]!;
    expect(buildPrompt(back)).toContain("directly behind, showing only the back of the sofa");
  });

  it("sizes portrait references as portrait output", () => {
    const job = {
      assetId: "x",
      view: "side",
      referenceSrc: "/demo/photo/products/x.webp",
      outputSrc: "/demo/photo/products/x--side.webp",
      category: "chair",
      landscape: false,
    } as const;
    expect(
      Object.fromEntries(multipartFields(job, { model: "m", quality: "low" })).size,
    ).toBe("1024x1536");
  });

  it("measures the anchor from alpha >= 16", () => {
    const width = 10;
    const height = 10;
    const rgba = new Uint8Array(width * height * 4);
    const set = (x: number, y: number, alpha: number) => {
      rgba[(y * width + x) * 4 + 3] = alpha;
    };
    set(2, 3, 255);
    set(6, 8, 200);
    set(9, 9, 8); // faint pixel ignored
    expect(measureAnchor(rgba, width, height)).toEqual({
      anchorX: 0.45,
      anchorY: 0.9,
    });
    expect(measureAnchor(new Uint8Array(400), 10, 10)).toBeNull();
  });

  it("rounds the anchor to four decimals and reaches the bottom edge", () => {
    const width = 3;
    const height = 7;
    const rgba = new Uint8Array(width * height * 4);
    rgba[(6 * width + 2) * 4 + 3] = 255;
    expect(measureAnchor(rgba, width, height)).toEqual({
      anchorX: 0.8333,
      anchorY: 1,
    });
  });

  it("merges by (assetId, view) and sorts", () => {
    const a = {
      assetId: "b",
      view: "side",
      src: "/demo/photo/products/b--side.webp",
      intrinsicWidth: 1,
      intrinsicHeight: 1,
      anchorX: 0,
      anchorY: 1,
      model: "m",
      generatedAt: "2026-09-03T00:00:00.000Z",
    } as const;
    const merged = mergeManifest({ version: 1, views: [{ ...a, anchorX: 0.1 }] }, [
      a,
      { ...a, assetId: "a", view: "back" },
    ]);
    expect(merged.views.map((view) => `${view.assetId}/${view.view}/${view.anchorX}`)).toEqual([
      "a/back/0",
      "b/side/0",
    ]);
  });

  it("sorts merged views by asset then canonical view order", () => {
    const base = {
      src: "/demo/photo/products/a--side.webp",
      intrinsicWidth: 1536,
      intrinsicHeight: 1024,
      anchorX: 0.5,
      anchorY: 0.9,
      model: "gpt-image-1",
      generatedAt: "2026-09-03T00:00:00.000Z",
    } as const;
    const merged = mergeManifest({ version: 1, views: [] }, [
      { ...base, assetId: "a", view: "back" },
      { ...base, assetId: "a", view: "side" },
      { ...base, assetId: "a", view: "back-quarter" },
    ]);
    expect(merged.views.map((view) => view.view)).toEqual([
      "side",
      "back-quarter",
      "back",
    ]);
  });

  it("renders a manifest module that round trips through the schema", () => {
    const manifest = mergeManifest({ version: 1, views: [] }, [
      {
        assetId: "hinoki-low-sofa",
        view: "side",
        src: "/demo/photo/products/hinoki-low-sofa--side.webp",
        intrinsicWidth: 1536,
        intrinsicHeight: 1024,
        anchorX: 0.5012,
        anchorY: 0.8701,
        model: "gpt-image-1",
        generatedAt: "2026-09-03T13:00:00.000Z",
      },
    ]);
    const rendered = renderManifestModule(manifest);
    expect(rendered).toContain(
      'import type { GeneratedViewManifest } from "./photo-views";',
    );
    expect(rendered).toContain("do not edit by hand");
    expect(rendered).toContain(
      "export const GENERATED_VIEW_MANIFEST: GeneratedViewManifest = {",
    );
    expect(rendered.endsWith(";\n")).toBe(true);

    const json = rendered.slice(
      rendered.indexOf("= ") + 2,
      rendered.lastIndexOf(";"),
    );
    expect(GeneratedViewManifestSchema.parse(JSON.parse(json))).toEqual(manifest);
  });
});

describe("generate-views shell", () => {
  const noop = async () => {
    throw new Error("not used in tests");
  };

  it("prints the plan and exits 0 for --dry-run without touching the network", async () => {
    const fetch = vi.fn();
    const log = vi.fn();
    const writeFile = vi.fn();
    const result = await runGenerateViews({
      argv: ["--dry-run"],
      env: {},
      fetch: fetch as unknown as typeof globalThis.fetch,
      log,
      readFile: noop,
      writeFile,
      decode: noop,
      encode: noop,
    });
    expect(result).toEqual({ exitCode: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain("28");
  });

  it("exits 2 without a key and never calls fetch", async () => {
    const fetch = vi.fn();
    const log = vi.fn();
    const result = await runGenerateViews({
      argv: [],
      env: {},
      fetch: fetch as unknown as typeof globalThis.fetch,
      log,
      readFile: noop,
      writeFile: noop,
      decode: noop,
      encode: noop,
    });
    expect(result).toEqual({ exitCode: 2 });
    expect(fetch).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain("OPENAI_API_KEY");
  });

  it("exits 2 on a bad argument and never calls fetch", async () => {
    const fetch = vi.fn();
    const log = vi.fn();
    const result = await runGenerateViews({
      argv: ["--view", "front-quarter"],
      env: { OPENAI_API_KEY: "sk-test" },
      fetch: fetch as unknown as typeof globalThis.fetch,
      log,
      readFile: noop,
      writeFile: noop,
      decode: noop,
      encode: noop,
    });
    expect(result).toEqual({ exitCode: 2 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never echoes the key it was given", async () => {
    const log = vi.fn();
    await runGenerateViews({
      argv: ["--dry-run", "--product", "hinoki-low-sofa"],
      env: { OPENAI_API_KEY: "sk-secret-value" },
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
      log,
      readFile: noop,
      writeFile: noop,
      decode: noop,
      encode: noop,
    });
    expect(log.mock.calls.flat().join("\n")).not.toContain("sk-secret-value");
  });
});
