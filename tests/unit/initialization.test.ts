import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

test("keeps the required MVP packages and test commands available", () => {
  expect(packageJson.dependencies).toEqual(
    expect.objectContaining({
      "@react-three/drei": expect.any(String),
      "@react-three/fiber": expect.any(String),
      immer: expect.any(String),
      three: expect.any(String),
      zod: expect.any(String),
      zustand: expect.any(String),
    }),
  );

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
    "test:e2e": "playwright test",
    "test:watch": "vitest",
  });
});
