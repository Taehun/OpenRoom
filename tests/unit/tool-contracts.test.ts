import { describe, expect, test } from "vitest";
import { z } from "zod";
import journeys from "../evals/webmcp-journeys.json";
import { CORE_TOOL_MANIFEST } from "../../src/webmcp/core-tool-manifest";
import {
  ADD_SCENE_TO_CART_JSON_SCHEMA,
  CORE_TOOL_NAMES,
  GET_SCENE_JSON_SCHEMA,
  GET_SELECTION_JSON_SCHEMA,
  MOVE_OBJECT_JSON_SCHEMA,
  REPLACE_OBJECT_JSON_SCHEMA,
  SEARCH_PRODUCTS_JSON_SCHEMA,
  addSceneToCartInputSchema,
  getSceneInputSchema,
  getSelectionInputSchema,
  moveObjectInputSchema,
  replaceObjectInputSchema,
  searchProductsInputSchema,
  ToolSceneObjectSchema,
  ToolSceneSchema,
  type CoreToolName,
} from "../../src/webmcp/tool-contracts";
import {
  invalidInputResult,
  toolError,
  toolSuccess,
  type ToolResult,
} from "../../src/webmcp/tool-result";

type SchemaNode = { readonly [key: string]: unknown };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function acceptsJsonSchema(schema: SchemaNode, value: unknown): boolean {
  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.includes(value)) return false;

  switch (schema.type) {
    case "object": {
      if (!isPlainObject(value)) return false;
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      if (required.some((key) => !(String(key) in value))) return false;
      if (
        schema.additionalProperties === false &&
        Object.keys(value).some((key) => !(key in properties))
      ) {
        return false;
      }
      return Object.entries(value).every(([key, entry]) => {
        const property = properties[key];
        return !isPlainObject(property) || acceptsJsonSchema(property, entry);
      });
    }
    case "array": {
      if (!Array.isArray(value)) return false;
      if (typeof schema.minItems === "number" && value.length < schema.minItems) {
        return false;
      }
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
        return false;
      }
      if (
        schema.uniqueItems === true &&
        new Set(value.map((item) => JSON.stringify(item))).size !== value.length
      ) {
        return false;
      }
      const items = schema.items;
      return !isPlainObject(items) ||
        value.every((item) => acceptsJsonSchema(items, item));
    }
    case "string": {
      if (typeof value !== "string") return false;
      if (typeof schema.minLength === "number" && value.length < schema.minLength) {
        return false;
      }
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
        return false;
      }
      return typeof schema.pattern !== "string" ||
        new RegExp(schema.pattern).test(value);
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      if (schema.type === "integer" && !Number.isInteger(value)) return false;
      if (typeof schema.minimum === "number" && value < schema.minimum) return false;
      return typeof schema.maximum !== "number" || value <= schema.maximum;
    }
    default:
      return true;
  }
}

const ZOD_INPUT_SCHEMAS: Record<CoreToolName, z.ZodType> = {
  get_scene: getSceneInputSchema,
  get_selection: getSelectionInputSchema,
  search_products: searchProductsInputSchema,
  replace_object: replaceObjectInputSchema,
  move_object: moveObjectInputSchema,
  add_scene_to_cart: addSceneToCartInputSchema,
};

interface ContractParityCase {
  readonly tool: CoreToolName;
  readonly input: unknown;
  /** Whether the browser's authoritative Zod contract accepts the input. */
  readonly zod: boolean;
  /** Whether the manifest JSON Schema admits the input to the handler. */
  readonly jsonSchema: boolean;
}

/** Agreement is the common case; asymmetric cases spell both layers out. */
function agree(
  tool: CoreToolName,
  input: unknown,
  accepted: boolean,
): ContractParityCase {
  return { tool, input, zod: accepted, jsonSchema: accepted };
}

const CONTRACT_PARITY_CASES: readonly ContractParityCase[] = [
  agree("get_scene", {}, true),
  agree("get_scene", { extra: true }, false),
  agree("get_selection", {}, true),
  agree("get_selection", { extra: 1 }, false),
  agree("search_products", {}, true),
  agree("search_products", { category: "sofa", query: "modern", limit: 3 }, true),
  agree("search_products", { limit: 0 }, false),
  agree("search_products", { limit: 4 }, false),
  agree("search_products", { query: "   " }, false),
  agree("search_products", { query: "q".repeat(81) }, false),
  agree("search_products", { category: "not-a-category" }, false),
  agree("search_products", { unknown: 1 }, false),
  agree(
    "replace_object",
    { productId: "table", expectedRevision: 1, expectedStateVersion: 1 },
    true,
  ),
  agree("replace_object", { productId: "table", expectedRevision: 1 }, false),
  agree(
    "replace_object",
    {
      objectId: "   ",
      productId: "table",
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
    false,
  ),
  agree(
    "replace_object",
    { productId: "table", expectedRevision: 0, expectedStateVersion: 1 },
    false,
  ),
  agree(
    "replace_object",
    { productId: "table", expectedRevision: 1.5, expectedStateVersion: 1 },
    false,
  ),
  agree(
    "move_object",
    {
      position: { x: 20, z: -20 },
      rotationYDegrees: 90,
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
    true,
  ),
  agree(
    "move_object",
    { position: { x: 21, z: 0 }, expectedRevision: 1, expectedStateVersion: 1 },
    false,
  ),
  agree(
    "move_object",
    {
      position: { x: 0, z: 0, y: 1 },
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
    false,
  ),
  agree(
    "move_object",
    {
      position: { x: 0, z: 0 },
      rotationYDegrees: 361,
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
    false,
  ),
  agree("move_object", { expectedRevision: 1, expectedStateVersion: 1 }, false),
  agree(
    "move_object",
    {
      position: { x: 0, z: 0 },
      facing: { x: -2, z: 0 },
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
    true,
  ),
  agree(
    "move_object",
    {
      position: { x: 0, z: 0 },
      facing: { x: 0, z: 1, y: 0 },
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
    false,
  ),
  {
    // JSON Schema cannot express "exactly one of these two", so the transport
    // gate admits both orientation inputs and the Zod refine is what answers
    // INVALID_INPUT with the `facing` issue path.
    tool: "move_object",
    input: {
      position: { x: 0, z: 0 },
      rotationYDegrees: 10,
      facing: { x: 0, z: 1 },
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
    zod: false,
    jsonSchema: true,
  },
  {
    // Same asymmetry for a zero-length vector: it is a well-formed pair of
    // numbers, and only Zod knows it names no direction.
    tool: "move_object",
    input: {
      position: { x: 0, z: 0 },
      facing: { x: 0, z: 0 },
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
    zod: false,
    jsonSchema: true,
  },
  agree("add_scene_to_cart", { expectedRevision: 1, expectedStateVersion: 1 }, true),
  agree(
    "add_scene_to_cart",
    { expectedRevision: 1, expectedStateVersion: 1, objectIds: ["sofa", "rug"] },
    true,
  ),
  agree(
    "add_scene_to_cart",
    { expectedRevision: 1, expectedStateVersion: 1, objectIds: ["rug", "rug"] },
    false,
  ),
  agree(
    "add_scene_to_cart",
    { expectedRevision: 1, expectedStateVersion: 1, objectIds: [] },
    false,
  ),
  agree(
    "add_scene_to_cart",
    { expectedRevision: 1, expectedStateVersion: 1, objectIds: ["   "] },
    false,
  ),
  agree(
    "add_scene_to_cart",
    {
      expectedRevision: 1,
      expectedStateVersion: 1,
      objectIds: Array.from({ length: 21 }, (_value, index) => `object-${index}`),
    },
    false,
  ),
  {
    // Zod trims each id before the uniqueness refine, so it sees a duplicate;
    // JSON Schema `uniqueItems` compares the raw strings and admits the call.
    // Zod is the authoritative validator, so the page still answers INVALID_INPUT.
    tool: "add_scene_to_cart",
    input: {
      expectedRevision: 1,
      expectedStateVersion: 1,
      objectIds: ["rug", "rug "],
    },
    zod: false,
    jsonSchema: true,
  },
];

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
        "cart-approval-shopify-lines",
        "face-the-sofa",
        "lamp-on-side-table",
      ]),
    );
    expect(journeys).toHaveLength(6);
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

  test("publishes facing and support on both contract layers and on the tool Scene shape", () => {
    expect(MOVE_OBJECT_JSON_SCHEMA.properties.facing).toMatchObject({
      type: "object",
      properties: { x: { type: "number" }, z: { type: "number" } },
      required: ["x", "z"],
      additionalProperties: false,
    });
    expect(MOVE_OBJECT_JSON_SCHEMA.properties.facing.description).toContain(
      "rotationYDegrees",
    );
    expect(MOVE_OBJECT_JSON_SCHEMA.required).not.toContain("facing");

    const object = {
      id: "chair_01",
      type: "chair",
      source: "placeholder",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      dimensionsM: { width: 1, height: 1, depth: 1 },
      locked: false,
      styleTags: [],
      addedBy: "seed",
    };
    // The stored Scene shape never carries facing or supportedBy; the tool
    // shape always carries both, and supportedBy is a nullable object id.
    expect(ToolSceneObjectSchema.safeParse(object).success).toBe(false);
    expect(
      ToolSceneObjectSchema.safeParse({ ...object, facing: { x: 0, z: 1 } })
        .success,
    ).toBe(false);
    expect(
      ToolSceneObjectSchema.safeParse({
        ...object,
        facing: { x: 0, z: 1 },
        supportedBy: null,
      }).success,
    ).toBe(true);
    expect(
      ToolSceneObjectSchema.safeParse({
        ...object,
        facing: { x: 0, z: 1 },
        supportedBy: "table_01",
      }).success,
    ).toBe(true);
    expect(
      ToolSceneObjectSchema.safeParse({
        ...object,
        facing: { x: 0, z: 1 },
        supportedBy: "",
      }).success,
    ).toBe(false);
    expect(
      ToolSceneObjectSchema.safeParse({
        ...object,
        facing: { x: 0, z: 1, y: 0 },
        supportedBy: null,
      }).success,
    ).toBe(false);
    const scene = {
      id: "demo",
      version: 1,
      revision: 1,
      source: "demo",
      styleIntent: null,
      room: { width: 4, height: 2.6, depth: 5 },
      openings: [],
      objects: [object],
      selectedObjectId: null,
    };
    expect(ToolSceneSchema.safeParse(scene).success).toBe(false);
    const facingScene = {
      ...scene,
      objects: [{ ...object, facing: { x: 0, z: 1 }, supportedBy: null }],
    };
    expect(ToolSceneSchema.safeParse(facingScene).success).toBe(true);
    // Overwriting `objects` needs Zod 4's `safeExtend`; these two guard that
    // the Scene contract it carries over stays exactly as strict as before.
    expect(
      ToolSceneSchema.safeParse({ ...facingScene, unexpected: 1 }).success,
    ).toBe(false);
    expect(
      ToolSceneSchema.safeParse({
        ...facingScene,
        selectedObjectId: "not_an_object",
      }).success,
    ).toBe(false);
    expect(
      ToolSceneSchema.safeParse({ ...facingScene, selectedObjectId: "chair_01" })
        .success,
    ).toBe(true);
  });

  test("reuses the published JSON Schemas in the shared manifest", () => {
    expect(CORE_TOOL_MANIFEST.map(({ inputSchema }) => inputSchema)).toEqual([
      GET_SCENE_JSON_SCHEMA,
      GET_SELECTION_JSON_SCHEMA,
      SEARCH_PRODUCTS_JSON_SCHEMA,
      REPLACE_OBJECT_JSON_SCHEMA,
      MOVE_OBJECT_JSON_SCHEMA,
      ADD_SCENE_TO_CART_JSON_SCHEMA,
    ]);
  });

  test("JSON Schema admits, Zod decides", () => {
    for (const { tool, input, zod, jsonSchema } of CONTRACT_PARITY_CASES) {
      const entry = CORE_TOOL_MANIFEST.find(({ name }) => name === tool);
      if (!entry) throw new Error(`Missing manifest entry for ${tool}.`);
      const label = `${tool} ${JSON.stringify(input)}`;

      expect([label, "zod", ZOD_INPUT_SCHEMAS[tool].safeParse(input).success])
        .toEqual([label, "zod", zod]);
      expect([label, "jsonSchema", acceptsJsonSchema(entry.inputSchema, input)])
        .toEqual([label, "jsonSchema", jsonSchema]);
      // The manifest schema is the transport gate and may be a superset: it must
      // never reject an input the authoritative Zod contract accepts.
      expect([label, "admits every Zod-valid input", !zod || jsonSchema])
        .toEqual([label, "admits every Zod-valid input", true]);
    }
  });
});
