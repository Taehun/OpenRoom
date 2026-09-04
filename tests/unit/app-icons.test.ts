import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import manifest from "../../app/manifest";

const root = resolve(import.meta.dirname, "../..");

function pngSize(relativePath: string) {
  const png = readFileSync(resolve(root, relativePath));
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

function icoSizes(relativePath: string) {
  const ico = readFileSync(resolve(root, relativePath));
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    const width = ico[offset] === 0 ? 256 : ico[offset];
    const height = ico[offset + 1] === 0 ? 256 : ico[offset + 1];
    return `${width}x${height}`;
  });
}

describe("OpenRoom application icons", () => {
  test("ships the browser, Apple, PWA, maskable, and store sizes", () => {
    expect(pngSize("app/apple-icon.png")).toEqual({ width: 180, height: 180 });
    expect(pngSize("public/icons/openroom-192.png")).toEqual({
      width: 192,
      height: 192,
    });
    expect(pngSize("public/icons/openroom-512.png")).toEqual({
      width: 512,
      height: 512,
    });
    expect(pngSize("public/icons/openroom-maskable-512.png")).toEqual({
      width: 512,
      height: 512,
    });
    expect(pngSize("public/icons/openroom-1024.png")).toEqual({
      width: 1024,
      height: 1024,
    });
    expect(icoSizes("app/favicon.ico")).toEqual(["16x16", "32x32", "48x48"]);

    const svg = readFileSync(resolve(root, "app/icon.svg"), "utf8");
    expect(svg).toContain("#4B6543");
    expect(svg).toContain("#FBF9F4");
    expect(
      readFileSync(resolve(root, "public/icons/openroom-mask-icon.svg"), "utf8"),
    ).toContain('fill="#000"');
  });

  test("publishes the installable icon variants and brand colors", () => {
    expect(manifest()).toMatchObject({
      name: "OpenRoom",
      short_name: "OpenRoom",
      start_url: "/",
      display: "standalone",
      background_color: "#FBF9F4",
      theme_color: "#4B6543",
      icons: [
        { src: "/icons/openroom-192.png", sizes: "192x192", purpose: "any" },
        { src: "/icons/openroom-512.png", sizes: "512x512", purpose: "any" },
        {
          src: "/icons/openroom-maskable-512.png",
          sizes: "512x512",
          purpose: "maskable",
        },
      ],
    });
  });
});
