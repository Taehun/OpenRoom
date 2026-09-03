import { describe, expect, test, vi } from "vitest";

import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import {
  footprintInsideRoom,
  objectFootprint,
} from "../../src/features/placement/footprint-geometry";
import { facingOf, roundFacing } from "../../src/features/photo/photo-facing";
import { createSceneStore } from "../../src/features/scene/scene-store";
import type { SceneStore } from "../../src/features/scene/scene-store";
import {
  createCoreTools,
  type ModelContextTool,
} from "../../src/webmcp/tool-handlers";
import {
  ToolSceneObjectSchema,
  ToolSceneSchema,
  type ToolScene,
} from "../../src/webmcp/tool-contracts";
import type {
  CartApprovalDraft,
  CatalogProduct,
  ToolContext,
} from "../../src/webmcp/tool-context";
import type { CommerceContext } from "../../src/features/commerce/commerce-types";
import {
  DEMO_COMMERCE,
  FIXTURE_VARIANT_IDS,
  SHOPIFY_COMMERCE,
  fixtureGid,
} from "../helpers/commerce-fixtures";

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

  test("returns the sixth replacement in the strict Core 6 shape", async () => {
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
      scene: ToolScene;
      message: string;
    };
    expect(finalResult.structuredContent.sceneRevision).toBe(7);
    expect(finalResult.structuredContent.stateVersion).toBe(7);
    // The committed Scene comes back in the same shape a read does: stored
    // fields untouched, plus the derived facing and support on every object.
    expect(data.scene).toEqual({
      ...store.getState().scene,
      objects: store.getState().scene.objects.map((object) => ({
        ...object,
        facing: roundFacing(facingOf(object.rotation[1])),
        supportedBy: null,
      })),
    });
    expect(ToolSceneSchema.safeParse(data.scene).success).toBe(true);
    expect(
      store
        .getState()
        .scene.objects.some(
          (object) => "facing" in object || "supportedBy" in object,
        ),
    ).toBe(false);
    expect(data.scene.revision).toBe(7);
    expect(Object.keys(data).sort()).toEqual(["message", "scene"]);
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
            demoVariantId: "demo-variant-travertine-plinth-table",
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
      storeDomain: "openroom-placeholder.myshopify.com",
      mcpEndpoint: "https://openroom-placeholder.myshopify.com/api/mcp",
      lines: [
        {
          productId: "oak-frame-table",
          merchandiseId: fixtureGid("oak-frame-table"),
          quantity: 1,
        },
      ],
      skipped: [],
      checkoutPermalink: `https://openroom-placeholder.myshopify.com/cart/${FIXTURE_VARIANT_IDS["oak-frame-table"]}:1`,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.commerce).toEqual(draft.commerce);
    expect(JSON.stringify(result)).not.toMatch(/token/i);
  });
});

// Real hosts are not required to hand `execute` an options bag: the Codex
// in-app browser calls `execute(input)` with nothing at all. The descriptors
// must still resolve a result instead of throwing on `signal.throwIfAborted`.
describe("execution options normalization", () => {
  function coreTool(name: string) {
    const store = createSceneStore();
    const { context, drafts } = createContext(store);
    const tool = createCoreTools(context).find(
      (candidate) => candidate.name === name,
    );
    if (!tool) throw new Error(`Missing ${name}`);
    return { tool, store, context, drafts };
  }

  test("reads the Scene when the host omits the options argument", async () => {
    const { tool } = coreTool("get_scene");
    const result = await (tool.execute as (input: unknown) => Promise<
      Awaited<ReturnType<ModelContextTool["execute"]>>
    >)({});

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.sceneRevision).toBe(1);
  });

  test("reads the Scene when the host passes an empty options bag", async () => {
    const { tool } = coreTool("get_scene");
    const result = await tool.execute({}, {} as never);

    expect(result.structuredContent.ok).toBe(true);
  });

  test("reads the Scene when the host passes an undefined signal", async () => {
    const { tool } = coreTool("get_scene");
    const result = await tool.execute({}, { signal: undefined } as never);

    expect(result.structuredContent.ok).toBe(true);
  });

  test("ignores an options bag whose signal is not an AbortSignal", async () => {
    const { tool } = coreTool("get_scene");
    const result = await tool.execute({}, { signal: null } as never);

    expect(result.structuredContent.ok).toBe(true);
  });

  test("applies a mutation when the host omits the options argument", async () => {
    const { tool, store } = coreTool("move_object");
    const result = await (tool.execute as (input: unknown) => Promise<
      Awaited<ReturnType<ModelContextTool["execute"]>>
    >)({
      objectId: "lamp_01",
      expectedRevision: 1,
      expectedStateVersion: 1,
      position: { x: 0.4, z: 0.4 },
    });

    expect(result.structuredContent.ok).toBe(true);
    expect(store.getState().scene.revision).toBe(2);
  });

  test("opens cart approval when the host omits the options argument", async () => {
    const store = createSceneStore();
    const { context, drafts } = createContext(store);
    const tools = createCoreTools(context);
    await execute(tools, "replace_object", {
      objectId: "table_01",
      productId: "travertine-plinth-table",
      expectedRevision: 1,
      expectedStateVersion: 1,
    });
    const cart = tools.find(({ name }) => name === "add_scene_to_cart");
    if (!cart) throw new Error("Missing add_scene_to_cart");
    const result = await (cart.execute as (input: unknown) => Promise<
      Awaited<ReturnType<ModelContextTool["execute"]>>
    >)({
      expectedRevision: store.getState().scene.revision,
      expectedStateVersion: store.getState().stateVersion,
    });

    expect(result.structuredContent.ok).toBe(true);
    expect(drafts).toHaveLength(1);
  });

  test("still aborts when the host does supply an aborted signal", async () => {
    const { tool, store, context } = coreTool("move_object");
    const getScene = vi.spyOn(context, "getScene");
    const controller = new AbortController();
    controller.abort();

    await expect(tool.execute({
      objectId: "lamp_01",
      expectedRevision: 1,
      expectedStateVersion: 1,
      position: { x: 0.4, z: 0.4 },
    }, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(getScene).not.toHaveBeenCalled();
    expect(store.getState().scene.revision).toBe(1);
  });
});

// Facing is derived, never stored: the Scene keeps `rotation[1]` as the only
// orientation, and the tool surface translates it both ways for the model.
describe("facing vectors", () => {
  function issuePaths(result: Awaited<ReturnType<ModelContextTool["execute"]>>) {
    if (result.structuredContent.ok) throw new Error("Expected an error result");
    return (result.structuredContent.error.issues ?? []).map(({ path }) => path);
  }

  test("derives a unit facing for every get_scene object and for get_selection", async () => {
    const store = createSceneStore();
    const tools = createCoreTools(createContext(store).context);

    const scene = await execute(tools, "get_scene", {});
    expect(scene.structuredContent.ok).toBe(true);
    if (!scene.structuredContent.ok) return;
    const data = ToolSceneSchema.parse(scene.structuredContent.data);
    expect(data.objects).not.toHaveLength(0);
    for (const object of data.objects) {
      expect(object.facing).toEqual(roundFacing(facingOf(object.rotation[1])));
    }

    const selection = await execute(tools, "get_selection", {});
    expect(selection.structuredContent.ok).toBe(true);
    if (!selection.structuredContent.ok) return;
    expect(ToolSceneObjectSchema.parse(selection.structuredContent.data))
      .toMatchObject({ id: "table_01", facing: { x: 0, z: 1 } });

    // The stored Scene never gains the derived field.
    expect(
      store.getState().scene.objects.some((object) => "facing" in object),
    ).toBe(false);
  });

  test("moves with a facing vector instead of rotationYDegrees", async () => {
    const store = createSceneStore();
    const { context } = createContext(store);
    const tools = createCoreTools(context);

    const result = await execute(tools, "move_object", {
      objectId: "chair_01",
      position: { x: 1, z: 0.5 },
      facing: { x: -2, z: 0 },
      expectedRevision: 1,
      expectedStateVersion: 1,
    });

    expect(result.structuredContent.ok).toBe(true);
    if (!result.structuredContent.ok) return;
    // facing -x is +90° of stored yaw: rotationYOf({x:-1,z:0}) = atan2(1, 0).
    expect(
      store.getState().scene.objects.find(({ id }) => id === "chair_01")
        ?.rotation[1],
    ).toBeCloseTo(Math.PI / 2, 9);
    // The Scene the move commits is returned in the same facing-carrying shape.
    const moved = ToolSceneSchema.parse(
      (result.structuredContent.data as { scene: unknown }).scene,
    );
    expect(moved.objects.find(({ id }) => id === "chair_01")?.facing).toEqual({
      x: -1,
      z: 0,
    });
    expect(
      store.getState().scene.objects.some((object) => "facing" in object),
    ).toBe(false);

    const scene = await execute(tools, "get_scene", {});
    if (!scene.structuredContent.ok) throw new Error("Expected a Scene");
    expect(
      ToolSceneSchema.parse(scene.structuredContent.data).objects.find(
        ({ id }) => id === "chair_01",
      )?.facing,
    ).toEqual({ x: -1, z: 0 });
  });

  test("rejects a zero-length facing and facing combined with rotationYDegrees", async () => {
    const store = createSceneStore();
    const { context } = createContext(store);
    const applyCommand = vi.spyOn(context, "applyCommand");
    const tools = createCoreTools(context);

    const zero = await execute(tools, "move_object", {
      objectId: "chair_01",
      position: { x: 1, z: 0.5 },
      facing: { x: 0, z: 0 },
      expectedRevision: 1,
      expectedStateVersion: 1,
    });
    expect(errorCode(zero)).toBe("INVALID_INPUT");
    expect(issuePaths(zero)).toContain("facing");

    const both = await execute(tools, "move_object", {
      objectId: "chair_01",
      position: { x: 1, z: 0.5 },
      facing: { x: 0, z: 1 },
      rotationYDegrees: 10,
      expectedRevision: 1,
      expectedStateVersion: 1,
    });
    expect(errorCode(both)).toBe("INVALID_INPUT");
    expect(issuePaths(both)).toContain("facing");

    expect(applyCommand).not.toHaveBeenCalled();
    expect(store.getState().scene.revision).toBe(1);
    expect(store.getState().stateVersion).toBe(1);
    expect(
      store.getState().scene.objects.find(({ id }) => id === "chair_01")
        ?.rotation[1],
    ).toBe(0);
  });

  // A non-finite component is caught by the field contract before the refine
  // runs, so the path is `facing.x` rather than `facing` — still an
  // INVALID_INPUT rooted at facing, and still nothing mutates.
  test("rejects a non-finite facing component before any command runs", async () => {
    const store = createSceneStore();
    const { context } = createContext(store);
    const applyCommand = vi.spyOn(context, "applyCommand");

    const result = await execute(createCoreTools(context), "move_object", {
      objectId: "chair_01",
      position: { x: 1, z: 0.5 },
      facing: { x: Number.NaN, z: 1 },
      expectedRevision: 1,
      expectedStateVersion: 1,
    });

    expect(errorCode(result)).toBe("INVALID_INPUT");
    expect(issuePaths(result).every((path) => path.startsWith("facing"))).toBe(
      true,
    );
    expect(issuePaths(result)).toContain("facing.x");
    expect(applyCommand).not.toHaveBeenCalled();
    expect(store.getState().scene.revision).toBe(1);
    expect(store.getState().stateVersion).toBe(1);
  });
});

describe("supportedBy on tool output", () => {
  function successData(result: Awaited<ReturnType<typeof execute>>) {
    if (!result.structuredContent.ok) {
      throw new Error("Expected a successful tool result");
    }
    return result.structuredContent.data;
  }

  test("reports a lamp moved onto the table, and null everywhere else", async () => {
    const store = createSceneStore();
    const tools = createCoreTools(createContext(store).context);
    const table = store
      .getState()
      .scene.objects.find(({ id }) => id === "table_01")!;

    const before = await execute(tools, "get_scene", {});
    const beforeScene = successData(before) as ToolScene;
    expect(
      beforeScene.objects.every((object) => object.supportedBy === null),
    ).toBe(true);

    const moved = await execute(tools, "move_object", {
      objectId: "lamp_01",
      position: { x: table.position[0], z: table.position[2] },
      expectedRevision: store.getState().scene.revision,
      expectedStateVersion: store.getState().stateVersion,
    });
    expect(moved.structuredContent.ok).toBe(true);
    const movedData = successData(moved) as {
      scene: ToolScene;
      appliedPosition: [number, number, number];
    };
    const movedLamp = movedData.scene.objects.find(
      ({ id }) => id === "lamp_01",
    )!;
    expect(movedLamp.supportedBy).toBe("table_01");
    expect(movedLamp.position[1]).toBeCloseTo(
      table.dimensionsM.height + movedLamp.dimensionsM.height / 2,
      9,
    );
    expect(movedData.appliedPosition).toEqual(movedLamp.position);
    expect(ToolSceneSchema.safeParse(movedData.scene).success).toBe(true);
    // Only the lamp is supported; the table it stands on still is not.
    expect(
      movedData.scene.objects.find(({ id }) => id === "table_01")!.supportedBy,
    ).toBeNull();

    // A read and a selection agree with the committed Scene.
    const after = await execute(tools, "get_scene", {});
    expect(
      (successData(after) as ToolScene).objects.find(
        ({ id }) => id === "lamp_01",
      )!.supportedBy,
    ).toBe("table_01");

    store.getState().selectObject("lamp_01");
    const selection = await execute(tools, "get_selection", {});
    expect(successData(selection)).toMatchObject({
      id: "lamp_01",
      supportedBy: "table_01",
    });
    expect(
      ToolSceneObjectSchema.safeParse(successData(selection)).success,
    ).toBe(true);

    // The stored Scene never grows the derived field.
    expect(
      store
        .getState()
        .scene.objects.some((object) => "supportedBy" in object),
    ).toBe(false);
  });

  test("clamps a move so the whole footprint stays on the floor", async () => {
    const store = createSceneStore();
    const tools = createCoreTools(createContext(store).context);

    const moved = await execute(tools, "move_object", {
      objectId: "sofa_01",
      position: { x: 20, z: 20 },
      rotationYDegrees: 45,
      expectedRevision: store.getState().scene.revision,
      expectedStateVersion: store.getState().stateVersion,
    });
    expect(moved.structuredContent.ok).toBe(true);
    const data = successData(moved) as {
      scene: ToolScene;
      adjustedToFit: boolean;
    };
    expect(data.adjustedToFit).toBe(true);
    const sofa = data.scene.objects.find(({ id }) => id === "sofa_01")!;
    expect(
      footprintInsideRoom(objectFootprint(sofa), data.scene.room, 0.1),
    ).toBe(true);
  });
});
