import { describe, expect, it } from "vitest";

import { createSceneStore } from "../../src/features/scene/scene-store";
import { createCoreTools } from "../../src/webmcp/tool-handlers";
import {
  CORE_TOOL_MANIFEST,
  canonicalManifestJson,
  getCoreToolManifestHash,
} from "../../src/webmcp/core-tool-manifest";
import { CORE_TOOL_NAMES } from "../../src/webmcp/tool-contracts";
import type { ToolContext } from "../../src/webmcp/tool-context";
import { UNCONFIGURED_COMMERCE } from "../helpers/commerce-fixtures";

function fakeToolContext(): ToolContext {
  const store = createSceneStore();
  return {
    getScene: () => store.getState().scene,
    getStateVersion: () => store.getState().stateVersion,
    getSelection: () => null,
    searchProducts: () => [],
    resolveProduct: () => undefined,
    applyCommand: (request) => store.getState().applyCommand(request),
    openCartApproval: () => undefined,
    commerce: UNCONFIGURED_COMMERCE,
  };
}

describe("Core 6 manifest", () => {
  it("is exact, ordered, serializable, and stable", async () => {
    expect(CORE_TOOL_MANIFEST.map(({ name }) => name)).toEqual(CORE_TOOL_NAMES);
    expect(JSON.parse(JSON.stringify(CORE_TOOL_MANIFEST))).toEqual(CORE_TOOL_MANIFEST);
    expect(canonicalManifestJson()).toBe(canonicalManifestJson());
    expect(await getCoreToolManifestHash()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("matches every browser descriptor field", () => {
    const tools = createCoreTools(fakeToolContext());
    for (const [index, tool] of tools.entries()) {
      const entry = CORE_TOOL_MANIFEST[index];
      expect(tool).toMatchObject({
        name: entry.name,
        description: entry.description,
        inputSchema: entry.inputSchema,
        annotations: entry.annotations,
      });
    }
  });

  it("sorts canonical keys recursively and hashes the canonical bytes", async () => {
    const canonical = canonicalManifestJson();
    const parsed: unknown = JSON.parse(canonical);
    expect(Array.isArray(parsed)).toBe(true);

    const sortedEverywhere = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.every(sortedEverywhere);
      if (typeof value !== "object" || value === null) return true;
      const keys = Object.keys(value);
      const sorted = [...keys].sort();
      return keys.every((key, index) => key === sorted[index]) &&
        Object.values(value).every(sortedEverywhere);
    };
    expect(sortedEverywhere(parsed)).toBe(true);
    expect(JSON.stringify(parsed)).toBe(canonical);

    const digest = await getCoreToolManifestHash();
    expect(digest).toBe(await getCoreToolManifestHash());
    expect(digest).toHaveLength(64);
    expect(digest).toBe(digest.toLowerCase());
  });

  it("deep-freezes every manifest entry", () => {
    for (const entry of CORE_TOOL_MANIFEST) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.annotations)).toBe(true);
      expect(Object.isFrozen(entry.inputSchema)).toBe(true);
    }
    expect(
      Object.isFrozen(
        (CORE_TOOL_MANIFEST[4].inputSchema as { properties: { position: object } })
          .properties.position,
      ),
    ).toBe(true);
  });

  it("hands descriptors their own annotations so hosts cannot mutate the manifest", async () => {
    const hashBefore = await getCoreToolManifestHash();
    const canonicalBefore = canonicalManifestJson();
    const [tool] = createCoreTools(fakeToolContext());

    expect(tool.annotations).not.toBe(CORE_TOOL_MANIFEST[0].annotations);
    tool.annotations.readOnlyHint = !tool.annotations.readOnlyHint;

    expect(CORE_TOOL_MANIFEST[0].annotations.readOnlyHint).toBe(true);
    expect(canonicalManifestJson()).toBe(canonicalBefore);
    expect(await getCoreToolManifestHash()).toBe(hashBefore);
  });

  it("keeps annotations exact for read-only and mutating tools", () => {
    const annotationsFor = (name: string) =>
      CORE_TOOL_MANIFEST.find((entry) => entry.name === name)?.annotations;

    for (const name of ["get_scene", "get_selection", "search_products"]) {
      expect(annotationsFor(name)).toEqual({
        readOnlyHint: true,
        untrustedContentHint: true,
      });
    }
    for (const name of ["replace_object", "move_object", "add_scene_to_cart"]) {
      expect(annotationsFor(name)).toEqual({
        readOnlyHint: false,
        untrustedContentHint: true,
      });
    }
  });
});
