import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
};

test("keeps the required MVP packages and reproducible test toolchain available", () => {
  expect(packageJson.dependencies).toEqual(
    expect.objectContaining({
      immer: expect.any(String),
      zod: expect.any(String),
      zustand: expect.any(String),
    }),
  );
  expect(packageJson.dependencies).not.toHaveProperty("three");
  expect(packageJson.dependencies).not.toHaveProperty("@react-three/fiber");
  expect(packageJson.dependencies).not.toHaveProperty("@react-three/drei");

  expect(packageJson.devDependencies).toEqual(
    expect.objectContaining({
      "@playwright/test": expect.any(String),
      "@testing-library/jest-dom": expect.any(String),
      "@testing-library/react": expect.any(String),
      "@testing-library/user-event": expect.any(String),
      jsdom: expect.any(String),
      vitest: expect.any(String),
    }),
  );

  expect(packageJson.scripts).toMatchObject({
    test: "vitest run",
    "test:e2e": expect.stringContaining("playwright test"),
    "test:watch": "vitest",
  });

  expect(packageJson.engines).toMatchObject({ node: "24.13.1" });
  expect(packageJson.devDependencies?.["@types/node"]).toMatch(/^\^24\./);
  expect(
    readFileSync(resolve(import.meta.dirname, "../../.node-version"), "utf8").trim(),
  ).toBe("24.13.1");
});
