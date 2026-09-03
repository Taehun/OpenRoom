import type { ZodIssue } from "zod";

import { enrichCartDraft } from "../features/commerce/shopify-cart";
import {
  facingOf,
  normalizeFacing,
  rotationYOf,
  roundFacing,
} from "../features/photo/photo-facing";
import {
  SceneObjectSchema,
  SceneSchema,
  type CommandResult,
  type Scene,
  type SceneObject,
  type SceneProduct,
} from "../features/scene/scene-schema";
import { CORE_TOOL_MANIFEST } from "./core-tool-manifest";
import {
  addSceneToCartInputSchema,
  getSceneInputSchema,
  getSelectionInputSchema,
  moveObjectInputSchema,
  replaceObjectInputSchema,
  searchProductsInputSchema,
  type CoreToolName,
  type ToolSceneObject,
} from "./tool-contracts";
import {
  CatalogProductSchema,
  type CartApprovalDraft,
  type CatalogProduct,
  type ToolContext,
} from "./tool-context";
import {
  invalidInputResult,
  toolError,
  toolSuccess,
  type ToolResult,
} from "./tool-result";

export interface ModelContextToolExecutionOptions {
  signal: AbortSignal;
}

/**
 * What a host is actually allowed to hand `execute`. WebMCP hosts in the wild
 * (the Codex in-app browser, for one) call `execute(input)` with no options at
 * all, so the public descriptor has to accept that and normalize it.
 */
export type HostToolExecutionOptions =
  | (Partial<ModelContextToolExecutionOptions> & Record<string, unknown>)
  | undefined;

export interface ModelContextTool {
  name: CoreToolName;
  description: string;
  inputSchema: object;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute(
    input: unknown,
    options?: HostToolExecutionOptions,
  ): Promise<ToolResult<unknown>>;
}

/**
 * Fills in a never-aborting signal when the host omitted one (or handed over
 * something that is not an `AbortSignal`), so every executor below can keep
 * requiring a real signal and abort semantics stay exactly as they were.
 */
export function normalizeExecutionOptions(
  options?: HostToolExecutionOptions,
): ModelContextToolExecutionOptions {
  const signal = options?.signal;
  return {
    ...options,
    signal:
      typeof AbortSignal !== "undefined" && signal instanceof AbortSignal
        ? signal
        : new AbortController().signal,
  };
}

type ToolExecutor = (
  input: unknown,
  options: ModelContextToolExecutionOptions,
) => Promise<ToolResult<unknown>>;

interface ContextSnapshot {
  scene: Scene;
  stateVersion: number;
}

function currentState(
  context: ToolContext,
  signal: AbortSignal,
): ContextSnapshot {
  signal.throwIfAborted();
  const scene = SceneSchema.parse(context.getScene());
  signal.throwIfAborted();
  const stateVersion = context.getStateVersion();
  signal.throwIfAborted();
  return {
    scene,
    stateVersion,
  };
}

function noSelectionResult(tool: CoreToolName, snapshot: ContextSnapshot) {
  return toolError(
    tool,
    snapshot.scene.revision,
    snapshot.stateVersion,
    "NO_SELECTION",
    "No Scene object is selected.",
    false,
  );
}

function commandFailure(
  tool: CoreToolName,
  result: Exclude<CommandResult, { ok: true }>,
  stateVersion: number,
) {
  const messages: Record<typeof result.error.code, string> = {
    OBJECT_NOT_FOUND: "The requested Scene object was not found.",
    OBJECT_LOCKED: "The requested Scene object is locked.",
    CATEGORY_MISMATCH: "The product category does not match the Scene object.",
    SCENE_REVISION_CONFLICT: "The Scene changed; retry with the latest state.",
  };
  return toolError(
    tool,
    result.scene.revision,
    stateVersion,
    result.error.code,
    messages[result.error.code],
    result.error.retryable,
    result.error.code === "SCENE_REVISION_CONFLICT"
      ? {
          latestRevision: result.scene.revision,
          latestStateVersion: stateVersion,
        }
      : undefined,
  );
}

function stateVersionConflict(
  tool: CoreToolName,
  snapshot: ContextSnapshot,
  expectedStateVersion: number,
) {
  if (snapshot.stateVersion === expectedStateVersion) return null;
  return toolError(
    tool,
    snapshot.scene.revision,
    snapshot.stateVersion,
    "SCENE_REVISION_CONFLICT",
    "The Scene context changed; retry with the latest state.",
    true,
    {
      latestRevision: snapshot.scene.revision,
      latestStateVersion: snapshot.stateVersion,
    },
  );
}

function catalogFailure(
  tool: CoreToolName,
  snapshot: ContextSnapshot,
  issues: readonly ZodIssue[],
) {
  return toolError(
    tool,
    snapshot.scene.revision,
    snapshot.stateVersion,
    "CATALOG_DATA_INVALID",
    "Catalog data failed validation.",
    false,
    { issues },
  );
}

function targetObjectId(
  context: ToolContext,
  tool: CoreToolName,
  explicitObjectId: string | undefined,
  snapshot: ContextSnapshot,
  signal: AbortSignal,
): string | ReturnType<typeof noSelectionResult> {
  if (explicitObjectId !== undefined) return explicitObjectId;
  signal.throwIfAborted();
  const selection = context.getSelection();
  return selection === null ? noSelectionResult(tool, snapshot) : selection.id;
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

/**
 * Orientation reaches the model as a facing vector: `rotation[1]` stays the
 * only stored value, and every object a tool hands back carries the derived
 * unit vector alongside it.
 */
function withFacing(object: SceneObject): ToolSceneObject {
  return { ...object, facing: roundFacing(facingOf(object.rotation[1])) };
}

function draftFor(scene: Scene, objects: readonly SceneObject[]): CartApprovalDraft {
  const items = objects.flatMap((object) => {
    if (object.source !== "product" || !object.product) return [];
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
  async function executeGetScene(
    input: unknown,
    { signal }: ModelContextToolExecutionOptions,
  ): Promise<ToolResult<unknown>> {
    const snapshot = currentState(context, signal);
    const parsed = getSceneInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInputResult(
        "get_scene",
        snapshot.scene.revision,
        snapshot.stateVersion,
        parsed.error,
      );
    }
    return toolSuccess(
      "get_scene",
      snapshot.scene.revision,
      snapshot.stateVersion,
      {
        ...snapshot.scene,
        objects: snapshot.scene.objects.map(withFacing),
      },
      "Scene returned.",
    );
  }

  async function executeGetSelection(
    input: unknown,
    { signal }: ModelContextToolExecutionOptions,
  ): Promise<ToolResult<unknown>> {
    const snapshot = currentState(context, signal);
    const parsed = getSelectionInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInputResult(
        "get_selection",
        snapshot.scene.revision,
        snapshot.stateVersion,
        parsed.error,
      );
    }
    signal.throwIfAborted();
    const selection = context.getSelection();
    if (selection === null) return noSelectionResult("get_selection", snapshot);
    return toolSuccess(
      "get_selection",
      snapshot.scene.revision,
      snapshot.stateVersion,
      withFacing(SceneObjectSchema.parse(selection)),
      "Selection returned.",
    );
  }

  async function executeSearchProducts(
    input: unknown,
    { signal }: ModelContextToolExecutionOptions,
  ): Promise<ToolResult<unknown>> {
    const snapshot = currentState(context, signal);
    const parsed = searchProductsInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInputResult(
        "search_products",
        snapshot.scene.revision,
        snapshot.stateVersion,
        parsed.error,
      );
    }
    signal.throwIfAborted();
    const products = CatalogProductSchema.array().safeParse(
      context.searchProducts(parsed.data),
    );
    if (!products.success) {
      return catalogFailure("search_products", snapshot, products.error.issues);
    }
    return toolSuccess(
      "search_products",
      snapshot.scene.revision,
      snapshot.stateVersion,
      { results: products.data },
      "Products returned.",
    );
  }

  async function executeReplaceObject(
    input: unknown,
    { signal }: ModelContextToolExecutionOptions,
  ): Promise<ToolResult<unknown>> {
    const snapshot = currentState(context, signal);
    const parsed = replaceObjectInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInputResult(
        "replace_object",
        snapshot.scene.revision,
        snapshot.stateVersion,
        parsed.error,
      );
    }
    const conflict = stateVersionConflict(
      "replace_object",
      snapshot,
      parsed.data.expectedStateVersion,
    );
    if (conflict) return conflict;
    const objectId = targetObjectId(
      context,
      "replace_object",
      parsed.data.objectId,
      snapshot,
      signal,
    );
    if (isToolError(objectId)) return objectId;
    signal.throwIfAborted();
    const rawProduct = context.resolveProduct(parsed.data.productId);
    if (rawProduct === undefined) {
      return toolError(
        "replace_object",
        snapshot.scene.revision,
        snapshot.stateVersion,
        "PRODUCT_NOT_FOUND",
        "The requested product was not found.",
        false,
      );
    }
    const product = CatalogProductSchema.safeParse(rawProduct);
    if (!product.success) {
      return catalogFailure("replace_object", snapshot, product.error.issues);
    }
    signal.throwIfAborted();
    const result = context.applyCommand({
      expectedRevision: parsed.data.expectedRevision,
      actor: "agent",
      command: {
        type: "replace",
        objectId,
        product: sceneProduct(product.data),
      },
    });
    const latestStateVersion = context.getStateVersion();
    if (!result.ok) {
      return commandFailure("replace_object", result, latestStateVersion);
    }
    return toolSuccess(
      "replace_object",
      result.scene.revision,
      latestStateVersion,
      { scene: SceneSchema.parse(result.scene), message: result.message },
      result.message,
    );
  }

  async function executeMoveObject(
    input: unknown,
    { signal }: ModelContextToolExecutionOptions,
  ): Promise<ToolResult<unknown>> {
    const snapshot = currentState(context, signal);
    const parsed = moveObjectInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInputResult(
        "move_object",
        snapshot.scene.revision,
        snapshot.stateVersion,
        parsed.error,
      );
    }
    const conflict = stateVersionConflict(
      "move_object",
      snapshot,
      parsed.data.expectedStateVersion,
    );
    if (conflict) return conflict;
    const objectId = targetObjectId(
      context,
      "move_object",
      parsed.data.objectId,
      snapshot,
      signal,
    );
    if (isToolError(objectId)) return objectId;
    signal.throwIfAborted();
    // A facing vector is the same orientation in the model's frame: converting
    // it here keeps the store, history, and conflict handling untouched. The
    // input contract has already rejected a zero-length or doubled-up value.
    const requestedFacing =
      parsed.data.facing === undefined
        ? null
        : normalizeFacing(parsed.data.facing);
    const rotationYDegrees =
      requestedFacing === null
        ? parsed.data.rotationYDegrees
        : (rotationYOf(requestedFacing) * 180) / Math.PI;
    const result = context.applyCommand({
      expectedRevision: parsed.data.expectedRevision,
      actor: "agent",
      command: {
        type: "move",
        objectId,
        position: parsed.data.position,
        rotationYDegrees,
      },
    });
    const latestStateVersion = context.getStateVersion();
    if (!result.ok) return commandFailure("move_object", result, latestStateVersion);
    return toolSuccess(
      "move_object",
      result.scene.revision,
      latestStateVersion,
      {
        scene: SceneSchema.parse(result.scene),
        message: result.message,
        adjustedToFit: result.adjustedToFit ?? false,
        appliedPosition: result.appliedPosition,
      },
      result.message,
    );
  }

  async function executeAddSceneToCart(
    input: unknown,
    { signal }: ModelContextToolExecutionOptions,
  ): Promise<ToolResult<unknown>> {
    const snapshot = currentState(context, signal);
    const parsed = addSceneToCartInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInputResult(
        "add_scene_to_cart",
        snapshot.scene.revision,
        snapshot.stateVersion,
        parsed.error,
      );
    }
    const stateConflict = stateVersionConflict(
      "add_scene_to_cart",
      snapshot,
      parsed.data.expectedStateVersion,
    );
    if (stateConflict) return stateConflict;
    if (snapshot.scene.revision !== parsed.data.expectedRevision) {
      return toolError(
        "add_scene_to_cart",
        snapshot.scene.revision,
        snapshot.stateVersion,
        "SCENE_REVISION_CONFLICT",
        "The Scene changed; retry with the latest state.",
        true,
        {
          latestRevision: snapshot.scene.revision,
          latestStateVersion: snapshot.stateVersion,
        },
      );
    }
    let objects: readonly SceneObject[];
    if (parsed.data.objectIds === undefined) {
      objects = snapshot.scene.objects.filter(
        (object) => object.source === "product" && object.addedBy !== "seed",
      );
    } else {
      const foundObjects = parsed.data.objectIds.map((objectId) =>
        snapshot.scene.objects.find(({ id }) => id === objectId),
      );
      if (foundObjects.some((object) => object === undefined)) {
        return toolError(
          "add_scene_to_cart",
          snapshot.scene.revision,
          snapshot.stateVersion,
          "OBJECT_NOT_FOUND",
          "A requested Scene object was not found.",
          false,
        );
      }
      objects = foundObjects.filter(
        (object): object is SceneObject => object !== undefined,
      );
    }
    const baseDraft = draftFor(snapshot.scene, objects);
    if (baseDraft.items.length === 0) {
      return toolError(
        "add_scene_to_cart",
        snapshot.scene.revision,
        snapshot.stateVersion,
        "NO_CART_ITEMS",
        "No eligible product-backed Scene objects are available.",
        false,
      );
    }
    const draft = enrichCartDraft(context.commerce, baseDraft);
    signal.throwIfAborted();
    context.openCartApproval(draft);
    return toolSuccess(
      "add_scene_to_cart",
      snapshot.scene.revision,
      snapshot.stateVersion,
      { draft },
      "Cart approval is ready.",
    );
  }

  const executors: Record<CoreToolName, ToolExecutor> = {
    get_scene: executeGetScene,
    get_selection: executeGetSelection,
    search_products: executeSearchProducts,
    replace_object: executeReplaceObject,
    move_object: executeMoveObject,
    add_scene_to_cart: executeAddSceneToCart,
  };

  return CORE_TOOL_MANIFEST.map((entry) => ({
    ...entry,
    annotations: { ...entry.annotations },
    execute: (input: unknown, options?: HostToolExecutionOptions) =>
      executors[entry.name](input, normalizeExecutionOptions(options)),
  }));
}
