import { describe, expect, test, vi } from "vitest";

import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import { createSceneStore } from "../../src/features/scene/scene-store";
import type { SceneStore } from "../../src/features/scene/scene-store";
import type { Scene } from "../../src/features/scene/scene-schema";
import {
  createCoreTools,
  type ModelContextTool,
} from "../../src/webmcp/tool-handlers";
import type {
  CartApprovalDraft,
  CatalogProduct,
  ToolContext,
} from "../../src/webmcp/tool-context";
import type { CommerceContext } from "../../src/features/commerce/commerce-types";
import { DEMO_COMMERCE, SHOPIFY_COMMERCE } from "../helpers/commerce-fixtures";

function createContext(
  store: SceneStore,
  catalog: readonly CatalogProduct[] = DEMO_PRODUCTS,
  commerce: CommerceContext = DEMO_COMMERCE,
) {
  const drafts: CartApprovalDraft[] = [];
  const context: ToolContext = {
    getScene: () => store.getState().scene,
    getStateVersion: () => store.getState().stateVersion,
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
    commerce,
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
  return tool.execute(input, { signal: new AbortController().signal });
}

function errorCode(result: Awaited<ReturnType<ModelContextTool["execute"]>>) {
  if (result.structuredContent.ok) throw new Error("Expected an error result");
  return result.structuredContent.error.code;
}

describe("WebMCP Core 6 handlers", () => {
  test("finds the modern-organic coffee table by style query", async () => {
    const store = createSceneStore();
    const { context } = createContext(store);
    const result = await execute(createCoreTools(context), "search_products", {
      category: "coffee_table",
      query: "modern",
    });

    expect(result.structuredContent.ok).toBe(true);
    if (!result.structuredContent.ok) return;
    expect((result.structuredContent.data as { results: CatalogProduct[] })
      .results.map(({ id }) => id)).toEqual(["travertine-plinth-table"]);
  });

  test("searches, replaces the selected table, and rejects a stale move", async () => {
    const store = createSceneStore();
    const { context } = createContext(store);
    const tools = createCoreTools(context);
    const applyCommand = vi.spyOn(context, "applyCommand");

    const search = await execute(tools, "search_products", {
      category: "coffee_table",
    });
    expect(search.structuredContent.ok).toBe(true);
    if (!search.structuredContent.ok) return;
    expect((search.structuredContent.data as { results: CatalogProduct[] }).results[1]?.id)
      .toBe("travertine-plinth-table");
    expect((search.structuredContent.data as { results: CatalogProduct[] }).results[0])
      .not.toBe(DEMO_PRODUCTS[0]);
    expect(search.structuredContent.stateVersion).toBe(1);

    const replace = await execute(tools, "replace_object", {
      productId: "travertine-plinth-table",
      expectedRevision: 1,
      expectedStateVersion: 1,
    });
    expect(replace.structuredContent.ok).toBe(true);
    expect(applyCommand).toHaveBeenCalledTimes(1);
    expect(store.getState().scene.revision).toBe(2);
    expect(store.getState().scene.objects.find(({ id }) => id === "table_01")
      ?.product?.id).toBe("travertine-plinth-table");
    expect(store.getState().scene.objects.find(({ id }) => id === "table_01")
      ?.assetId).toBe("travertine-plinth-table");

    const staleMove = await execute(tools, "move_object", {
      objectId: "lamp_01",
      expectedRevision: 1,
      expectedStateVersion: 2,
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

  test("returns the atomically arranged sixth replacement in the strict Core 6 shape", async () => {
    const store = createSceneStore();
    const tools = createCoreTools(createContext(store).context);
    const objectIds = store.getState().scene.objects.map(({ id }) => id);
    let finalResult: Awaited<ReturnType<ModelContextTool["execute"]>> | undefined;

    for (let index = 0; index < objectIds.length; index += 1) {
      const objectId = objectIds[index]!;
      const object = store.getState().scene.objects.find(({ id }) => id === objectId)!;
      const product = DEMO_PRODUCTS.find(({ category }) => category === object.type)!;
      finalResult = await execute(tools, "replace_object", {
        objectId,
        productId: product.id,
        expectedRevision: index + 1,
        expectedStateVersion: index + 1,
      });
      expect(finalResult.structuredContent.ok).toBe(true);
    }

    if (!finalResult || !finalResult.structuredContent.ok) {
      throw new Error("Expected the final replacement to succeed");
    }
    const data = finalResult.structuredContent.data as {
      scene: Scene;
      message: string;
    };
    expect(finalResult.structuredContent.sceneRevision).toBe(7);
    expect(finalResult.structuredContent.stateVersion).toBe(7);
    expect(data.scene).toEqual(store.getState().scene);
    expect(data.scene.revision).toBe(7);
    expect(Object.keys(data).sort()).toEqual(["message", "scene"]);
    expect("placementOutcome" in data).toBe(false);
  });

  test("rejects a revision ABA with the monotonic state version", async () => {
    const store = createSceneStore();
    const before = structuredClone(store.getState().scene);
    store.getState().applyCommand({
      expectedRevision: 1,
      actor: "human",
      command: { type: "set-style", style: "warm japandi" },
    });
    expect(store.getState().undo()).toBe(true);
    expect(store.getState()).toMatchObject({
      stateVersion: 3,
      scene: { revision: 1 },
    });
    const { context } = createContext(store);
    const applyCommand = vi.spyOn(context, "applyCommand");

    const result = await execute(createCoreTools(context), "move_object", {
      objectId: "lamp_01",
      expectedRevision: 1,
      expectedStateVersion: 1,
      position: { x: 0, z: 0 },
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      sceneRevision: 1,
      stateVersion: 3,
      error: {
        code: "SCENE_REVISION_CONFLICT",
        latestRevision: 1,
        latestStateVersion: 3,
      },
    });
    expect(applyCommand).not.toHaveBeenCalled();
    expect(store.getState().scene).toEqual(before);
  });

  test("rejects an omitted-target mutation after selection changes", async () => {
    const store = createSceneStore();
    store.getState().selectObject("chair_01");
    const { context } = createContext(store);
    const applyCommand = vi.spyOn(context, "applyCommand");

    const result = await execute(createCoreTools(context), "replace_object", {
      productId: "oak-frame-table",
      expectedRevision: 1,
      expectedStateVersion: 1,
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      sceneRevision: 1,
      stateVersion: 2,
      error: {
        code: "SCENE_REVISION_CONFLICT",
        latestRevision: 1,
        latestStateVersion: 2,
      },
    });
    expect(applyCommand).not.toHaveBeenCalled();
    expect(store.getState().scene.objects.find(({ id }) => id === "chair_01")?.source)
      .toBe("placeholder");
  });

  test("returns INVALID_INPUT without invoking a command", async () => {
    const store = createSceneStore();
    const { context } = createContext(store);
    const applyCommand = vi.spyOn(context, "applyCommand");

    const result = await execute(createCoreTools(context), "move_object", {
      expectedRevision: 1,
      expectedStateVersion: 1,
      position: { x: 21, z: 0 },
    });

    expect(errorCode(result)).toBe("INVALID_INPUT");
    expect(result.structuredContent).toMatchObject({
      ok: false,
      tool: "move_object",
      sceneRevision: 1,
      stateVersion: 1,
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
      expectedStateVersion: 2,
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
      expectedStateVersion: 1,
    });

    expect(errorCode(result)).toBe("PRODUCT_NOT_FOUND");
    expect(store.getState().scene.revision).toBe(1);
  });

  test("returns structured errors for malformed catalog search results", async () => {
    const malformedCatalog = [{
      ...DEMO_PRODUCTS[0],
      description: "x".repeat(501),
    }] as unknown as readonly CatalogProduct[];
    const store = createSceneStore();
    const { context } = createContext(store, malformedCatalog);

    const result = await execute(createCoreTools(context), "search_products", {});

    expect(result.structuredContent).toMatchObject({
      ok: false,
      sceneRevision: 1,
      stateVersion: 1,
      error: {
        code: "CATALOG_DATA_INVALID",
        retryable: false,
        issues: [{ path: "0.description" }],
      },
    });
  });

  test("returns a structured error for a malformed resolved product", async () => {
    const malformedCatalog = [{
      ...DEMO_PRODUCTS[0],
      description: `${"x".repeat(500)} `,
    }] as unknown as readonly CatalogProduct[];
    const store = createSceneStore();
    const { context } = createContext(store, malformedCatalog);
    const applyCommand = vi.spyOn(context, "applyCommand");

    const result = await execute(createCoreTools(context), "replace_object", {
      productId: DEMO_PRODUCTS[0].id,
      expectedRevision: 1,
      expectedStateVersion: 1,
    });

    expect(errorCode(result)).toBe("CATALOG_DATA_INVALID");
    expect(applyCommand).not.toHaveBeenCalled();
    expect(store.getState().scene.revision).toBe(1);
  });

  test("aborts a mutation before reading or applying Scene state", async () => {
    const store = createSceneStore();
    const { context } = createContext(store);
    const getScene = vi.spyOn(context, "getScene");
    const getStateVersion = vi.spyOn(context, "getStateVersion");
    const applyCommand = vi.spyOn(context, "applyCommand");
    const controller = new AbortController();
    controller.abort();
    const tool = createCoreTools(context).find(({ name }) => name === "replace_object");
    if (!tool) throw new Error("Missing replace_object");

    await expect(tool.execute({
      productId: "travertine-plinth-table",
      expectedRevision: 1,
      expectedStateVersion: 1,
    }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

    expect(getScene).not.toHaveBeenCalled();
    expect(getStateVersion).not.toHaveBeenCalled();
    expect(applyCommand).not.toHaveBeenCalled();
    expect(store.getState().scene.revision).toBe(1);
  });

  test("aborts cart execution before opening approval", async () => {
    const store = createSceneStore();
    const { context, drafts } = createContext(store);
    const controller = new AbortController();
    controller.abort();
    const tool = createCoreTools(context).find(({ name }) => name === "add_scene_to_cart");
    if (!tool) throw new Error("Missing add_scene_to_cart");

    await expect(tool.execute({
      expectedRevision: 1,
      expectedStateVersion: 1,
    }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

    expect(drafts).toEqual([]);
    expect(store.getState().scene.revision).toBe(1);
  });

  test("preserves command-layer missing-object, locked, and category errors", async () => {
    const missingStore = createSceneStore();
    const missingContext = createContext(missingStore).context;
    const missing = await execute(createCoreTools(missingContext), "move_object", {
      objectId: "missing_01",
      expectedRevision: 1,
      expectedStateVersion: 1,
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
      expectedStateVersion: 2,
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
      {
        objectId: "table_01",
        productId: "oak-chair",
        expectedRevision: 1,
        expectedStateVersion: 1,
      },
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
        stateVersion: 1,
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
        stateVersion: 1,
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
      expectedStateVersion: 1,
    });
    const result = await execute(tools, "add_scene_to_cart", {
      expectedRevision: 2,
      expectedStateVersion: 2,
      objectIds: ["table_01", "sofa_01"],
    });

    expect(result.structuredContent).toMatchObject({
      ok: true,
      tool: "add_scene_to_cart",
      sceneRevision: 2,
      stateVersion: 2,
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
      expectedStateVersion: 1,
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
      { expectedRevision: 1, expectedStateVersion: 1 },
    );
    expect(errorCode(empty)).toBe("NO_CART_ITEMS");

    const missingStore = createSceneStore();
    const missing = await execute(
      createCoreTools(createContext(missingStore).context),
      "add_scene_to_cart",
      {
        expectedRevision: 1,
        expectedStateVersion: 1,
        objectIds: ["missing_01"],
      },
    );
    expect(errorCode(missing)).toBe("OBJECT_NOT_FOUND");

    const placeholder = await execute(
      createCoreTools(createContext(createSceneStore()).context),
      "add_scene_to_cart",
      {
        expectedRevision: 1,
        expectedStateVersion: 1,
        objectIds: ["table_01"],
      },
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
      { readOnlyHint: true, untrustedContentHint: true },
      { readOnlyHint: true, untrustedContentHint: true },
      { readOnlyHint: true, untrustedContentHint: true },
      { readOnlyHint: false, untrustedContentHint: true },
      { readOnlyHint: false, untrustedContentHint: true },
      { readOnlyHint: false, untrustedContentHint: true },
    ]);
  });
});

describe("add_scene_to_cart commerce block", () => {
  test("omits commerce in demo mode", async () => {
    const store = createSceneStore();
    const { context, drafts } = createContext(store, DEMO_PRODUCTS, DEMO_COMMERCE);
    const tools = createCoreTools(context);

    await execute(tools, "replace_object", {
      productId: "oak-frame-table",
      expectedRevision: store.getState().scene.revision,
      expectedStateVersion: store.getState().stateVersion,
    });
    const result = await execute(tools, "add_scene_to_cart", {
      expectedRevision: store.getState().scene.revision,
      expectedStateVersion: store.getState().stateVersion,
    });

    expect(result.structuredContent.ok).toBe(true);
    if (!result.structuredContent.ok) return;
    const { draft } = result.structuredContent.data as { draft: CartApprovalDraft };
    expect("commerce" in draft).toBe(false);
    expect(drafts).toHaveLength(1);
    expect("commerce" in drafts[0]!).toBe(false);
  });

  test("returns public Shopify lines, skipped products, and the MCP endpoint in shopify mode", async () => {
    const store = createSceneStore();
    const { context, drafts } = createContext(store, DEMO_PRODUCTS, SHOPIFY_COMMERCE);
    const tools = createCoreTools(context);

    await execute(tools, "replace_object", {
      productId: "oak-frame-table",
      expectedRevision: store.getState().scene.revision,
      expectedStateVersion: store.getState().stateVersion,
    });
    const result = await execute(tools, "add_scene_to_cart", {
      expectedRevision: store.getState().scene.revision,
      expectedStateVersion: store.getState().stateVersion,
    });

    expect(result.structuredContent.ok).toBe(true);
    if (!result.structuredContent.ok) return;
    const { draft } = result.structuredContent.data as { draft: CartApprovalDraft };
    expect(draft.commerce).toEqual({
      provider: "shopify",
      storeDomain: "nook-placeholder.myshopify.com",
      mcpEndpoint: "https://nook-placeholder.myshopify.com/api/mcp",
      lines: [
        {
          productId: "oak-frame-table",
          merchandiseId: "gid://shopify/ProductVariant/1003",
          quantity: 1,
        },
      ],
      skipped: [],
      checkoutPermalink: "https://nook-placeholder.myshopify.com/cart/1003:1",
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.commerce).toEqual(draft.commerce);
    expect(JSON.stringify(result)).not.toMatch(/token/i);
  });
});
