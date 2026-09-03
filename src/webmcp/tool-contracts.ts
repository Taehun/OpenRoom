import { z } from "zod";
import { normalizeFacing } from "../features/photo/photo-facing";
import {
  ProductCategorySchema,
  SceneObjectSchema,
  SceneSchema,
} from "../features/scene/scene-schema";

export const CORE_TOOL_NAMES = [
  "get_scene",
  "get_selection",
  "search_products",
  "replace_object",
  "move_object",
  "add_scene_to_cart",
] as const;

export type CoreToolName = (typeof CORE_TOOL_NAMES)[number];

const objectId = z.string().max(64).trim().min(1);
const productId = z.string().max(80).trim().min(1);
const query = z.string().max(80).trim().min(1).optional();
const expectedRevision = z.number().int().min(1);
const expectedStateVersion = z.number().int().min(1);
const coordinate = z.number().finite().min(-20).max(20);
const rotationYDegrees = z.number().finite().min(-360).max(360).optional();
const facing = z
  .object({
    x: z.number().finite(),
    z: z.number().finite(),
  })
  .strict()
  .optional();
/** Shared so the input refine and the handler guard cannot drift apart. */
export const FACING_DIRECTION_MESSAGE =
  "facing must be a non-zero finite XZ vector";
const limit = z.number().int().min(1).max(3).default(3);

export const getSceneInputSchema = z.object({}).strict();
export type GetSceneInput = z.infer<typeof getSceneInputSchema>;

export const getSelectionInputSchema = z.object({}).strict();
export type GetSelectionInput = z.infer<typeof getSelectionInputSchema>;

export const searchProductsInputSchema = z
  .object({
    category: ProductCategorySchema.optional(),
    query,
    limit,
  })
  .strict();
export type SearchProductsInput = z.infer<typeof searchProductsInputSchema>;

export const replaceObjectInputSchema = z
  .object({
    objectId: objectId.optional(),
    productId,
    expectedRevision,
    expectedStateVersion,
  })
  .strict();
export type ReplaceObjectInput = z.infer<typeof replaceObjectInputSchema>;

const position = z
  .object({
    x: coordinate,
    z: coordinate,
  })
  .strict();

export const moveObjectInputSchema = z
  .object({
    objectId: objectId.optional(),
    position,
    rotationYDegrees,
    facing,
    expectedRevision,
    expectedStateVersion,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.facing === undefined) return;
    if (input.rotationYDegrees !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["facing"],
        message: "Provide either facing or rotationYDegrees, not both",
      });
    }
    if (normalizeFacing(input.facing) === null) {
      context.addIssue({
        code: "custom",
        path: ["facing"],
        message: FACING_DIRECTION_MESSAGE,
      });
    }
  });
export type MoveObjectInput = z.infer<typeof moveObjectInputSchema>;

export const addSceneToCartInputSchema = z
  .object({
    expectedRevision,
    expectedStateVersion,
    objectIds: z.array(objectId).min(1).max(20).superRefine((ids, context) => {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: "custom",
          message: "objectIds must contain unique values",
        });
      }
    }).optional(),
  })
  .strict();
export type AddSceneToCartInput = z.infer<typeof addSceneToCartInputSchema>;

/**
 * Tool output shapes. Every object a tool returns carries the facing derived
 * from `rotation[1]` and the id of the object it stands on; the stored
 * `SceneSchema` stays free of both, so nothing can persist a second source of
 * truth for orientation or for the support relation.
 */
export const FacingSchema = z.object({ x: z.number(), z: z.number() }).strict();
export const ToolSceneObjectSchema = SceneObjectSchema.extend({
  facing: FacingSchema,
  supportedBy: z.string().min(1).nullable(),
});
// `safeExtend` is what Zod 4 requires to overwrite a key on a schema that
// carries refinements; the Scene's `selectedObjectId` check keeps running.
export const ToolSceneSchema = SceneSchema.safeExtend({
  objects: z.array(ToolSceneObjectSchema),
});
export type ToolSceneObject = z.infer<typeof ToolSceneObjectSchema>;
export type ToolScene = z.infer<typeof ToolSceneSchema>;

type JsonSchema = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, unknown>;
  required?: readonly string[];
};

export const GET_SCENE_JSON_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies JsonSchema;

export const GET_SELECTION_JSON_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies JsonSchema;

export const SEARCH_PRODUCTS_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: ["sofa", "coffee_table", "rug", "floor_lamp", "chair", "plant"],
    },
    query: { type: "string", minLength: 1, maxLength: 80, pattern: "\\S" },
    limit: { type: "integer", minimum: 1, maximum: 3, default: 3 },
  },
  additionalProperties: false,
} as const satisfies JsonSchema;

export const REPLACE_OBJECT_JSON_SCHEMA = {
  type: "object",
  properties: {
    objectId: { type: "string", minLength: 1, maxLength: 64, pattern: "\\S" },
    productId: { type: "string", minLength: 1, maxLength: 80, pattern: "\\S" },
    expectedRevision: { type: "integer", minimum: 1 },
    expectedStateVersion: { type: "integer", minimum: 1 },
  },
  required: ["productId", "expectedRevision", "expectedStateVersion"],
  additionalProperties: false,
} as const satisfies JsonSchema;

export const MOVE_OBJECT_JSON_SCHEMA = {
  type: "object",
  properties: {
    objectId: { type: "string", minLength: 1, maxLength: 64, pattern: "\\S" },
    position: {
      type: "object",
      properties: {
        x: { type: "number", minimum: -20, maximum: 20 },
        z: { type: "number", minimum: -20, maximum: 20 },
      },
      required: ["x", "z"],
      additionalProperties: false,
    },
    rotationYDegrees: { type: "number", minimum: -360, maximum: 360 },
    facing: {
      type: "object",
      description:
        "Unit XZ direction the object's front points; {x:0,z:1} faces the camera side (front wall), {x:0,z:-1} faces the back wall. Mutually exclusive with rotationYDegrees.",
      properties: {
        x: { type: "number" },
        z: { type: "number" },
      },
      required: ["x", "z"],
      additionalProperties: false,
    },
    expectedRevision: { type: "integer", minimum: 1 },
    expectedStateVersion: { type: "integer", minimum: 1 },
  },
  required: ["position", "expectedRevision", "expectedStateVersion"],
  additionalProperties: false,
} as const satisfies JsonSchema;

export const ADD_SCENE_TO_CART_JSON_SCHEMA = {
  type: "object",
  properties: {
    expectedRevision: { type: "integer", minimum: 1 },
    expectedStateVersion: { type: "integer", minimum: 1 },
    objectIds: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 64, pattern: "\\S" },
      minItems: 1,
      maxItems: 20,
      uniqueItems: true,
    },
  },
  required: ["expectedRevision", "expectedStateVersion"],
  additionalProperties: false,
} as const satisfies JsonSchema;
