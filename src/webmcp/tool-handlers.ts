import {
  SceneObjectSchema,
  SceneSchema,
  type CommandResult,
  type Scene,
  type SceneObject,
  type SceneProduct,
} from "../features/scene/scene-schema";
import {
  ADD_SCENE_TO_CART_JSON_SCHEMA,
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
  type CoreToolName,
} from "./tool-contracts";
import type { CartApprovalDraft, CatalogProduct, ToolContext } from "./tool-context";
import {
  invalidInputResult,
  toolError,
  toolSuccess,
  type ToolResult,
} from "./tool-result";

export interface ModelContextTool {
  name: CoreToolName;
  description: string;
  inputSchema: object;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute(input: unknown, signal: AbortSignal): Promise<ToolResult<unknown>>;
}

function currentScene(context: ToolContext): Scene {
  return SceneSchema.parse(context.getScene());
}

function noSelectionResult(tool: CoreToolName, scene: Scene) {
  return toolError(
    tool,
    scene.revision,
    "NO_SELECTION",
    "No Scene object is selected.",
    false,
  );
}

function commandFailure(tool: CoreToolName, result: Exclude<CommandResult, { ok: true }>) {
  const messages: Record<typeof result.error.code, string> = {
    OBJECT_NOT_FOUND: "The requested Scene object was not found.",
    OBJECT_LOCKED: "The requested Scene object is locked.",
    CATEGORY_MISMATCH: "The product category does not match the Scene object.",
    SCENE_REVISION_CONFLICT: "The Scene changed; retry with the latest revision.",
  };
  return toolError(
    tool,
    result.scene.revision,
    result.error.code,
    messages[result.error.code],
    result.error.retryable,
    result.error.code === "SCENE_REVISION_CONFLICT"
      ? { latestRevision: result.scene.revision }
      : undefined,
  );
}

function targetObjectId(
  context: ToolContext,
  tool: CoreToolName,
  explicitObjectId: string | undefined,
  scene: Scene,
): string | ReturnType<typeof noSelectionResult> {
  if (explicitObjectId !== undefined) return explicitObjectId;
  const selection = context.getSelection();
  return selection === null ? noSelectionResult(tool, scene) : selection.id;
}

function isToolError(value: unknown): value is ReturnType<typeof noSelectionResult> {
  return typeof value === "object" && value !== null && "structuredContent" in value;
}

function sceneProduct(product: CatalogProduct): SceneProduct {
  return {
    id: product.id,
    variantId: product.variantId,
    title: product.title,
    category: product.category,
    price: product.price,
    dimensionsCm: product.dimensionsCm,
    styleTags: product.styleTags,
    color: product.color,
    material: product.material,
  };
}

function draftFor(scene: Scene, objects: readonly SceneObject[]): CartApprovalDraft {
  const items = objects.flatMap((object) => {
    if (!object.product) return [];
    return [{
      objectId: object.id,
      productId: object.product.id,
      variantId: object.product.variantId,
      title: object.product.title,
      quantity: 1 as const,
      price: object.product.price,
    }];
  });

  return {
    id: `scene-${scene.id}-rev-${scene.revision}`,
    sceneId: scene.id,
    sceneRevision: scene.revision,
    items,
    totalMinor: items.reduce((total, item) => total + item.price.amountMinor, 0),
  };
}

export function createCoreTools(context: ToolContext): readonly ModelContextTool[] {
  return [
    {
      name: "get_scene",
      description: "Return the current validated Scene.",
      inputSchema: GET_SCENE_JSON_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute(input) {
        const parsed = getSceneInputSchema.safeParse(input);
        if (!parsed.success) {
          return invalidInputResult("get_scene", currentScene(context).revision, parsed.error);
        }
        const scene = currentScene(context);
        return toolSuccess("get_scene", scene.revision, scene, "Scene returned.");
      },
    },
    {
      name: "get_selection",
      description: "Return the currently selected Scene object.",
      inputSchema: GET_SELECTION_JSON_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute(input) {
        const parsed = getSelectionInputSchema.safeParse(input);
        if (!parsed.success) {
          return invalidInputResult("get_selection", currentScene(context).revision, parsed.error);
        }
        const scene = currentScene(context);
        const selection = context.getSelection();
        if (selection === null) return noSelectionResult("get_selection", scene);
        return toolSuccess(
          "get_selection",
          scene.revision,
          SceneObjectSchema.parse(selection),
          "Selection returned.",
        );
      },
    },
    {
      name: "search_products",
      description: "Search the local product catalog in deterministic order.",
      inputSchema: SEARCH_PRODUCTS_JSON_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        const parsed = searchProductsInputSchema.safeParse(input);
        if (!parsed.success) {
          return invalidInputResult("search_products", currentScene(context).revision, parsed.error);
        }
        const scene = currentScene(context);
        return toolSuccess(
          "search_products",
          scene.revision,
          { results: context.searchProducts(parsed.data) },
          "Products returned.",
        );
      },
    },
    {
      name: "replace_object",
      description: "Replace an explicit or selected Scene object with a catalog product.",
      inputSchema: REPLACE_OBJECT_JSON_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        const parsed = replaceObjectInputSchema.safeParse(input);
        if (!parsed.success) {
          return invalidInputResult("replace_object", currentScene(context).revision, parsed.error);
        }
        const scene = currentScene(context);
        const objectId = targetObjectId(
          context,
          "replace_object",
          parsed.data.objectId,
          scene,
        );
        if (isToolError(objectId)) return objectId;
        const product = context.resolveProduct(parsed.data.productId);
        if (!product) {
          return toolError(
            "replace_object",
            scene.revision,
            "PRODUCT_NOT_FOUND",
            "The requested product was not found.",
            false,
          );
        }
        const result = context.applyCommand({
          expectedRevision: parsed.data.expectedRevision,
          actor: "agent",
          command: { type: "replace", objectId, product: sceneProduct(product) },
        });
        if (!result.ok) return commandFailure("replace_object", result);
        return toolSuccess(
          "replace_object",
          result.scene.revision,
          { scene: SceneSchema.parse(result.scene), message: result.message },
          result.message,
        );
      },
    },
    {
      name: "move_object",
      description: "Move an explicit or selected Scene object.",
      inputSchema: MOVE_OBJECT_JSON_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const parsed = moveObjectInputSchema.safeParse(input);
        if (!parsed.success) {
          return invalidInputResult("move_object", currentScene(context).revision, parsed.error);
        }
        const scene = currentScene(context);
        const objectId = targetObjectId(
          context,
          "move_object",
          parsed.data.objectId,
          scene,
        );
        if (isToolError(objectId)) return objectId;
        const result = context.applyCommand({
          expectedRevision: parsed.data.expectedRevision,
          actor: "agent",
          command: {
            type: "move",
            objectId,
            position: parsed.data.position,
            rotationYDegrees: parsed.data.rotationYDegrees,
          },
        });
        if (!result.ok) return commandFailure("move_object", result);
        return toolSuccess(
          "move_object",
          result.scene.revision,
          {
            scene: SceneSchema.parse(result.scene),
            message: result.message,
            adjustedToFit: result.adjustedToFit ?? false,
            appliedPosition: result.appliedPosition,
          },
          result.message,
        );
      },
    },
    {
      name: "add_scene_to_cart",
      description: "Open a local approval draft for product-backed Scene objects.",
      inputSchema: ADD_SCENE_TO_CART_JSON_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const parsed = addSceneToCartInputSchema.safeParse(input);
        if (!parsed.success) {
          return invalidInputResult("add_scene_to_cart", currentScene(context).revision, parsed.error);
        }
        const scene = currentScene(context);
        if (scene.revision !== parsed.data.expectedRevision) {
          return toolError(
            "add_scene_to_cart",
            scene.revision,
            "SCENE_REVISION_CONFLICT",
            "The Scene changed; retry with the latest revision.",
            true,
            { latestRevision: scene.revision },
          );
        }
        let objects: readonly SceneObject[];
        if (parsed.data.objectIds === undefined) {
          objects = scene.objects.filter(
            (object) => object.source === "product" && object.addedBy !== "seed",
          );
        } else {
          const foundObjects = parsed.data.objectIds.map((objectId) =>
            scene.objects.find(({ id }) => id === objectId),
          );
          if (foundObjects.some((object) => object === undefined)) {
            return toolError(
              "add_scene_to_cart",
              scene.revision,
              "OBJECT_NOT_FOUND",
              "A requested Scene object was not found.",
              false,
            );
          }
          objects = foundObjects.filter(
            (object): object is SceneObject => object !== undefined,
          );
        }
        const draft = draftFor(scene, objects);
        if (draft.items.length === 0) {
          return toolError(
            "add_scene_to_cart",
            scene.revision,
            "NO_CART_ITEMS",
            "No eligible product-backed Scene objects are available.",
            false,
          );
        }
        context.openCartApproval(draft);
        return toolSuccess(
          "add_scene_to_cart",
          scene.revision,
          { draft },
          "Cart approval is ready.",
        );
      },
    },
  ];
}
