import { describe, expect, test, vi } from "vitest";

import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import { createSceneStore } from "../../src/features/scene/scene-store";
import type { SceneStore } from "../../src/features/scene/scene-store";
import {
  createCoreTools,
  type ModelContextTool,
} from "../../src/webmcp/tool-handlers";
import type {
  CartApprovalDraft,
  CatalogProduct,
  ToolContext,
} from "../../src/webmcp/tool-context";

function createContext(
  store: SceneStore,
  catalog: readonly CatalogProduct[] = DEMO_PRODUCTS,
) {
  const drafts: CartApprovalDraft[] = [];
  const context: ToolContext = {
    getScene: () => store.getState().scene,
    getSelection: () => {
      const { scene } = store.getState();
      return scene.objects.find(({ id }) => id === scene.selectedObjectId) ?? null;
    },
    searchProducts: ({ category, query, limit }) => {
      const normalizedQuery = query?.toLocaleLowerCase();
      return catalog
        .filter((product) =>
          category === undefined || product.category === category,
        )
        .filter((product) =>
          normalizedQuery === undefined || [
            product.title,
            product.description,
            ...product.styleTags,
            product.color ?? "",
            product.material ?? "",
          ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
        )
        .slice(0, limit);
    },
    resolveProduct: (productId) =>
      catalog.find((product) => product.id === productId),
    applyCommand: (request) => store.getState().applyCommand(request),
    openCartApproval: (draft) => {
      drafts.push(draft);
    },
  };

  return { context, drafts };
}

async function execute(
  tools: readonly ModelContextTool[],
  name: string,
  input: unknown,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing ${name}`);
  return tool.execute(input, new AbortController().signal);
}

function errorCode(result: Awaited<ReturnType<ModelContextTool["execute"]>>) {
  if (result.structuredContent.ok) throw new Error("Expected an error result");
  return result.structuredContent.error.code;
}

describe("WebMCP Core 6 handlers", () => {
  test("searches, replaces the selected table, and rejects a stale move", async () => {
    const store = createSceneStore();
    const { context } = createContext(store);
    const tools = createCoreTools(context);

    const search = await execute(tools, "search_products", {
      category: "coffee_table",
    });
    expect(search.structuredContent.ok).toBe(true);
    if (!search.structuredContent.ok) return;
    expect((search.structuredContent.data as { results: CatalogProduct[] }).results[1]?.id)
      .toBe("travertine-plinth-table");

    const replace = await execute(tools, "replace_object", {
      productId: "travertine-plinth-table",
      expectedRevision: 1,
    });
    expect(replace.structuredContent.ok).toBe(true);
    expect(store.getState().scene.revision).toBe(2);
    expect(store.getState().scene.objects.find(({ id }) => id === "table_01")
      ?.product?.id).toBe("travertine-plinth-table");

    const staleMove = await execute(tools, "move_object", {
      objectId: "lamp_01",
      expectedRevision: 1,
      position: { x: 0, z: 0 },
    });
    expect(staleMove.structuredContent.ok).toBe(false);
    if (staleMove.structuredContent.ok) return;
    expect(staleMove.structuredContent.error).toMatchObject({
      code: "SCENE_REVISION_CONFLICT",
      latestRevision: 2,
      retryable: true,
    });
    expect(store.getState().scene.revision).toBe(2);
  });

  test("returns INVALID_INPUT without invoking a command", async () => {
    const store = createSceneStore();
    const { context } = createContext(store);
    const applyCommand = vi.spyOn(context, "applyCommand");

    const result = await execute(createCoreTools(context), "move_object", {
      expectedRevision: 1,
      position: { x: 21, z: 0 },
    });

    expect(errorCode(result)).toBe("INVALID_INPUT");
    expect(result.structuredContent).toMatchObject({
      ok: false,
      tool: "move_object",
      sceneRevision: 1,
      error: { retryable: true, issues: [{ path: "position.x" }] },
    });
    expect(applyCommand).not.toHaveBeenCalled();
  });

  test("returns NO_SELECTION for an omitted mutation target", async () => {
    const store = createSceneStore();
    store.getState().selectObject(null);
    const { context } = createContext(store);

    const result = await execute(createCoreTools(context), "replace_object", {
      productId: "oak-frame-table",
      expectedRevision: 1,
    });

    expect(errorCode(result)).toBe("NO_SELECTION");
    expect(store.getState().scene.revision).toBe(1);
  });

  test("returns PRODUCT_NOT_FOUND without changing the Scene", async () => {
    const store = createSceneStore();
    const { context } = createContext(store);

    const result = await execute(createCoreTools(context), "replace_object", {
      productId: "missing-table",
      expectedRevision: 1,
    });

    expect(errorCode(result)).toBe("PRODUCT_NOT_FOUND");
    expect(store.getState().scene.revision).toBe(1);
  });

  test("preserves command-layer missing-object, locked, and category errors", async () => {
    const missingStore = createSceneStore();
    const missingContext = createContext(missingStore).context;
    const missing = await execute(createCoreTools(missingContext), "move_object", {
      objectId: "missing_01",
      expectedRevision: 1,
      position: { x: 0, z: 0 },
    });
    expect(errorCode(missing)).toBe("OBJECT_NOT_FOUND");

    const lockedStore = createSceneStore();
    lockedStore.getState().applyCommand({
      expectedRevision: 1,
      actor: "human",
      command: { type: "preserve", objectId: "table_01", preserved: true },
    });
    const locked = await execute(createCoreTools(createContext(lockedStore).context), "replace_object", {
      objectId: "table_01",
      productId: "oak-frame-table",
      expectedRevision: 2,
    });
    expect(errorCode(locked)).toBe("OBJECT_LOCKED");

    const mismatchCatalog: readonly CatalogProduct[] = [{
      ...DEMO_PRODUCTS[0],
      id: "oak-chair",
      variantId: "demo-variant-oak-chair",
      title: "Oak Chair",
      category: "chair",
    }];
    const mismatch = await execute(
      createCoreTools(createContext(createSceneStore(), mismatchCatalog).context),
      "replace_object",
      { objectId: "table_01", productId: "oak-chair", expectedRevision: 1 },
    );
    expect(errorCode(mismatch)).toBe("CATEGORY_MISMATCH");
  });

  test("returns the validated Scene and selected object in success envelopes", async () => {
    const store = createSceneStore();
    const tools = createCoreTools(createContext(store).context);

    const scene = await execute(tools, "get_scene", {});
    const selection = await execute(tools, "get_selection", {});

    expect(scene).toMatchObject({
      content: [{ type: "text" }],
      structuredContent: {
        ok: true,
        tool: "get_scene",
        sceneRevision: 1,
        data: { id: "demo-living-room", revision: 1 },
      },
    });
    expect(scene.isError).toBeUndefined();
    expect(selection).toMatchObject({
      content: [{ type: "text" }],
      structuredContent: {
        ok: true,
        tool: "get_selection",
        sceneRevision: 1,
        data: { id: "table_01" },
      },
    });
    expect(selection.isError).toBeUndefined();
  });

  test("returns NO_SELECTION from get_selection when nothing is selected", async () => {
    const store = createSceneStore();
    store.getState().selectObject(null);

    const result = await execute(createCoreTools(createContext(store).context), "get_selection", {});

    expect(errorCode(result)).toBe("NO_SELECTION");
  });

  test("builds an approval-only cart draft from explicit product-backed IDs", async () => {
    const store = createSceneStore();
    const { context, drafts } = createContext(store);
    const tools = createCoreTools(context);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await execute(tools, "replace_object", {
      productId: "travertine-plinth-table",
      expectedRevision: 1,
    });
    const result = await execute(tools, "add_scene_to_cart", {
      expectedRevision: 2,
      objectIds: ["table_01", "sofa_01"],
    });

    expect(result.structuredContent).toMatchObject({
      ok: true,
      tool: "add_scene_to_cart",
      sceneRevision: 2,
      data: {
        draft: {
          id: "scene-demo-living-room-rev-2",
          sceneId: "demo-living-room",
          sceneRevision: 2,
          totalMinor: 24900,
          items: [{
            objectId: "table_01",
            productId: "travertine-plinth-table",
            variantId: "demo-variant-travertine-plinth-table",
            title: "Travertine Plinth Table",
            quantity: 1,
            price: { amountMinor: 24900, currency: "USD" },
          }],
        },
      },
    });
    expect(drafts).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("does not draft an explicit placeholder carrying product metadata", async () => {
    const seed = structuredClone(createSceneStore().getState().scene);
    const table = seed.objects.find(({ id }) => id === "table_01");
    if (!table) throw new Error("Expected the demo table");
    table.product = {
      id: "oak-frame-table",
      variantId: "demo-variant-oak-frame-table",
      title: "Oak Frame Table",
      category: "coffee_table",
      price: { amountMinor: 16900, currency: "USD" },
      dimensionsCm: { width: 105, height: 40, depth: 55 },
      styleTags: ["japandi", "light-oak"],
      color: "light-oak",
      material: "oak",
    };
    table.source = "placeholder";
    table.addedBy = "human";
    const store = createSceneStore(seed);
    const { context, drafts } = createContext(store);

    const result = await execute(createCoreTools(context), "add_scene_to_cart", {
      expectedRevision: 1,
      objectIds: ["table_01"],
    });

    expect(errorCode(result)).toBe("NO_CART_ITEMS");
    expect(drafts).toEqual([]);
  });

  test("rejects an empty cart and missing explicit cart object IDs", async () => {
    const emptyStore = createSceneStore();
    const empty = await execute(
      createCoreTools(createContext(emptyStore).context),
      "add_scene_to_cart",
      { expectedRevision: 1 },
    );
    expect(errorCode(empty)).toBe("NO_CART_ITEMS");

    const missingStore = createSceneStore();
    const missing = await execute(
      createCoreTools(createContext(missingStore).context),
      "add_scene_to_cart",
      { expectedRevision: 1, objectIds: ["missing_01"] },
    );
    expect(errorCode(missing)).toBe("OBJECT_NOT_FOUND");

    const placeholder = await execute(
      createCoreTools(createContext(createSceneStore()).context),
      "add_scene_to_cart",
      { expectedRevision: 1, objectIds: ["table_01"] },
    );
    expect(errorCode(placeholder)).toBe("NO_CART_ITEMS");
  });

  test("publishes the required annotation values and complete descriptor set", () => {
    const tools = createCoreTools(createContext(createSceneStore()).context);

    expect(tools.map(({ name }) => name)).toEqual([
      "get_scene",
      "get_selection",
      "search_products",
      "replace_object",
      "move_object",
      "add_scene_to_cart",
    ]);
    expect(tools.map(({ annotations }) => annotations)).toEqual([
      { readOnlyHint: true, untrustedContentHint: false },
      { readOnlyHint: true, untrustedContentHint: false },
      { readOnlyHint: true, untrustedContentHint: true },
      { readOnlyHint: false, untrustedContentHint: true },
      { readOnlyHint: false, untrustedContentHint: false },
      { readOnlyHint: false, untrustedContentHint: false },
    ]);
  });
});
