import { z } from "zod";

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const DimensionsMSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    depth: z.number().positive(),
  })
  .strict();

export const SceneObjectTypeSchema = z.enum([
  "sofa",
  "coffee_table",
  "rug",
  "floor_lamp",
  "chair",
  "plant",
  "side_table",
  "bookshelf",
  "unknown",
]);

export const ProductCategorySchema = z.enum([
  "sofa",
  "coffee_table",
  "rug",
  "floor_lamp",
  "chair",
  "plant",
  "side_table",
  "bookshelf",
]);

export const SceneProductSchema = z
  .object({
    id: z.string().min(1),
    variantId: z.string().min(1),
    title: z.string().min(1),
    category: ProductCategorySchema,
    price: z
      .object({
        amountMinor: z.number().int().nonnegative(),
        currency: z.literal("USD"),
      })
      .strict(),
    dimensionsCm: z
      .object({
        width: z.number().positive(),
        height: z.number().positive(),
        depth: z.number().positive(),
      })
      .strict(),
    styleTags: z.array(z.string()),
    color: z.string().nullable(),
    material: z.string().nullable(),
  })
  .strict();

export const SceneObjectSchema = z
  .object({
    id: z.string().min(1),
    type: SceneObjectTypeSchema,
    source: z.enum(["placeholder", "product"]),
    position: Vec3Schema,
    rotation: Vec3Schema,
    scale: Vec3Schema,
    dimensionsM: DimensionsMSchema,
    locked: z.boolean(),
    styleTags: z.array(z.string()),
    assetId: z.string().min(1).optional(),
    product: SceneProductSchema.optional(),
    addedBy: z.enum(["seed", "human", "agent"]),
  })
  .strict()
  .superRefine((object, context) => {
    if (object.source === "product" && !object.product) {
      context.addIssue({
        code: "custom",
        message: "Product-sourced objects require product metadata",
        path: ["product"],
      });
    }
  });

export const OpeningSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["door", "window"]),
    wall: z.enum(["front", "back", "left", "right"]),
    offset: z.number().min(0).max(1),
    widthM: z.number().positive(),
    heightM: z.number().positive(),
  })
  .strict();

export const SceneSchema = z
  .object({
    id: z.string().min(1),
    version: z.literal(1),
    revision: z.number().int().min(1),
    source: z.enum(["upload", "demo"]),
    styleIntent: z.string().nullable(),
    room: DimensionsMSchema,
    openings: z.array(OpeningSchema),
    objects: z.array(SceneObjectSchema),
    selectedObjectId: z.string().nullable(),
  })
  .strict()
  .superRefine((scene, context) => {
    if (
      scene.selectedObjectId !== null &&
      !scene.objects.some((object) => object.id === scene.selectedObjectId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Selected object must exist in the Scene",
        path: ["selectedObjectId"],
      });
    }
  });

export type Vec3 = z.infer<typeof Vec3Schema>;
export type DimensionsM = z.infer<typeof DimensionsMSchema>;
export type SceneObjectType = z.infer<typeof SceneObjectTypeSchema>;
export type ProductCategory = z.infer<typeof ProductCategorySchema>;
export type SceneProduct = z.infer<typeof SceneProductSchema>;
export type SceneObject = z.infer<typeof SceneObjectSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type ToolMode = "select" | "rotate";
export type CommandActor = "human" | "agent";

export type SceneCommand =
  | { type: "set-style"; style: string }
  | { type: "preserve"; objectId: string; preserved: boolean }
  | {
      type: "replace";
      objectId: string;
      product: SceneProduct;
    }
  | {
      type: "move";
      objectId: string;
      position: { x: number; z: number };
      rotationYDegrees?: number;
    };

export interface CommandRequest {
  expectedRevision: number;
  command: SceneCommand;
  actor: CommandActor;
}

export type SceneCommandErrorCode =
  | "OBJECT_NOT_FOUND"
  | "OBJECT_LOCKED"
  | "CATEGORY_MISMATCH"
  | "SCENE_REVISION_CONFLICT";

export type CommandResult =
  | {
      ok: true;
      scene: Scene;
      previousScene: Scene;
      message: string;
      adjustedToFit?: boolean;
      appliedPosition?: Vec3;
    }
  | {
      ok: false;
      scene: Scene;
      error: {
        code: SceneCommandErrorCode;
        message: string;
        retryable: boolean;
      };
    };
