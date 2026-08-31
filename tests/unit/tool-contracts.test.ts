import { describe, expect, test } from "vitest";
import { z } from "zod";
import journeys from "../evals/webmcp-journeys.json";
import {
  ADD_SCENE_TO_CART_JSON_SCHEMA,
  CORE_TOOL_NAMES,
  GET_SCENE_JSON_SCHEMA,
  MOVE_OBJECT_JSON_SCHEMA,
  REPLACE_OBJECT_JSON_SCHEMA,
  SEARCH_PRODUCTS_JSON_SCHEMA,
  addSceneToCartInputSchema,
  getSceneInputSchema,
  moveObjectInputSchema,
  replaceObjectInputSchema,
  searchProductsInputSchema,
} from "../../src/webmcp/tool-contracts";
import {
  invalidInputResult,
  toolError,
  toolSuccess,
  type ToolResult,
} from "../../src/webmcp/tool-result";

describe("WebMCP Core 6 contracts", () => {
  test("publishes the stable Core tool names", () => {
    expect(CORE_TOOL_NAMES).toEqual([
      "get_scene",
      "get_selection",
      "search_products",
      "replace_object",
      "move_object",
      "add_scene_to_cart",
    ]);
  });

  test.each([
    ["get_scene", getSceneInputSchema, { extra: true }],
    ["search_products limit", searchProductsInputSchema, { limit: 0 }],
    [
      "move_object coordinate",
      moveObjectInputSchema,
      { expectedRevision: 1, expectedStateVersion: 1, position: { x: 21, z: 0 } },
    ],
  ])("rejects invalid %s input", (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  test("keeps every input contract strict and bounded", () => {
    expect(GET_SCENE_JSON_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(MOVE_OBJECT_JSON_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        position: {
          type: "object",
          additionalProperties: false,
          required: ["x", "z"],
        },
      },
    });
    expect(ADD_SCENE_TO_CART_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(REPLACE_OBJECT_JSON_SCHEMA.required).toContain("expectedStateVersion");
    expect(MOVE_OBJECT_JSON_SCHEMA.required).toContain("expectedStateVersion");
    expect(ADD_SCENE_TO_CART_JSON_SCHEMA.required).toContain(
      "expectedStateVersion",
    );
    expect(MOVE_OBJECT_JSON_SCHEMA.properties.position.additionalProperties).toBe(
      false,
    );
  });

  test("uses the documented defaults and bounds", () => {
    expect(searchProductsInputSchema.parse({}).limit).toBe(3);
    expect(
      searchProductsInputSchema.safeParse({ category: "not-a-category" }).success,
    ).toBe(false);
    expect(
      replaceObjectInputSchema.safeParse({
        productId: "table",
        expectedRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      replaceObjectInputSchema.safeParse({
        productId: "table",
        expectedRevision: 1,
        expectedStateVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      addSceneToCartInputSchema.safeParse({
        expectedRevision: 1,
        expectedStateVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      addSceneToCartInputSchema.safeParse({
        expectedRevision: 1,
        expectedStateVersion: 1,
        objectIds: ["table", "table"],
      }).success,
    ).toBe(false);
  });

  test("rejects whitespace-only IDs and queries in both contract layers", () => {
    expect(searchProductsInputSchema.safeParse({ query: "   " }).success).toBe(false);
    expect(
      replaceObjectInputSchema.safeParse({
        objectId: "   ",
        productId: "product",
        expectedRevision: 1,
        expectedStateVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      replaceObjectInputSchema.safeParse({
        productId: "   ",
        expectedRevision: 1,
        expectedStateVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      moveObjectInputSchema.safeParse({
        objectId: "   ",
        expectedRevision: 1,
        expectedStateVersion: 1,
        position: { x: 0, z: 0 },
      }).success,
    ).toBe(false);
    expect(
      addSceneToCartInputSchema.safeParse({
        expectedRevision: 1,
        expectedStateVersion: 1,
        objectIds: ["   "],
      }).success,
    ).toBe(false);

    expect(SEARCH_PRODUCTS_JSON_SCHEMA.properties.query.pattern).toBe("\\S");
    expect(REPLACE_OBJECT_JSON_SCHEMA.properties.objectId.pattern).toBe("\\S");
    expect(REPLACE_OBJECT_JSON_SCHEMA.properties.productId.pattern).toBe("\\S");
    expect(MOVE_OBJECT_JSON_SCHEMA.properties.objectId.pattern).toBe("\\S");
    expect(ADD_SCENE_TO_CART_JSON_SCHEMA.properties.objectIds.items.pattern).toBe(
      "\\S",
    );
  });

  test("applies raw string bounds before trimming", () => {
    expect(searchProductsInputSchema.safeParse({ query: `${"q".repeat(80)} ` }).success)
      .toBe(false);
    expect(replaceObjectInputSchema.safeParse({
      objectId: `${"o".repeat(64)} `,
      productId: "product",
      expectedRevision: 1,
      expectedStateVersion: 1,
    }).success).toBe(false);
    expect(replaceObjectInputSchema.safeParse({
      productId: `${"p".repeat(80)} `,
      expectedRevision: 1,
      expectedStateVersion: 1,
    }).success).toBe(false);
  });

  test("returns the typed success envelope without an error marker", () => {
    const result: ToolResult<{ value: string }> = toolSuccess(
      "get_scene",
      4,
      9,
      { value: "scene" },
      "Scene returned.",
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.structuredContent).toMatchObject({
      ok: true,
      tool: "get_scene",
      sceneRevision: 4,
      stateVersion: 9,
      data: { value: "scene" },
    });
    expect(result.content[0].text).not.toContain("raw-input");
  });

  test("returns a normalized typed error envelope", () => {
    const result = toolError(
      "move_object",
      7,
      11,
      "SCENE_REVISION_CONFLICT",
      "The Scene changed; retry with the latest revision.",
      true,
      {
        latestRevision: 8,
        latestStateVersion: 12,
        issues: [{ path: "expectedRevision", message: "stale" }],
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      tool: "move_object",
      sceneRevision: 7,
      stateVersion: 11,
      error: {
        code: "SCENE_REVISION_CONFLICT",
        retryable: true,
        latestRevision: 8,
        latestStateVersion: 12,
        issues: [{ path: "expectedRevision", message: "stale" }],
      },
    });
    expect(result.content[0].text).not.toContain("raw-input");
  });

  test("normalizes Zod issues for invalid input", () => {
    const parsed = moveObjectInputSchema.safeParse({
      expectedRevision: 1,
      expectedStateVersion: 1,
      position: { x: 21, z: 0 },
    });
    if (parsed.success) throw new Error("expected invalid input");

    const result = invalidInputResult("move_object", 3, 6, parsed.error);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      tool: "move_object",
      sceneRevision: 3,
      stateVersion: 6,
      error: { code: "INVALID_INPUT", retryable: true },
    });
    const error = result.structuredContent.ok ? null : result.structuredContent.error;
    expect(error?.issues?.[0]?.path).toBe("position.x");
  });

  test("describes the named static evaluation-manifest journeys", () => {
    expect(journeys.map((journey) => journey.id)).toEqual(
      expect.arrayContaining([
        "replace-second-result",
        "stale-move-conflict",
        "cart-approval-only",
      ]),
    );
    expect(journeys).toHaveLength(3);
    expect(journeys.every((journey) =>
      typeof journey.prompt === "string" &&
      Array.isArray(journey.expectedTools) &&
      Array.isArray(journey.assertions),
    )).toBe(true);
  });

  test("keeps the empty-input schemas strict", () => {
    expect(getSceneInputSchema.parse({})).toEqual({});
    expect(getSceneInputSchema.safeParse({ unexpected: 1 }).success).toBe(false);
    expect(z.object({}).strict().safeParse({ unexpected: 1 }).success).toBe(false);
  });
});
