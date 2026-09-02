import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { createDemoScene } from "../../src/demo/demo-scene";
import { DemoWorkspace } from "../../src/features/demo/demo-workspace";
import { createSceneStore } from "../../src/features/scene/scene-store";
import type { ModelContextTool } from "../../src/webmcp/tool-handlers";
import { completedProductScene } from "../helpers/natural-placement-fixtures";

interface CapturedRegistration {
  signal: AbortSignal;
  tool: ModelContextTool;
}

const CORE_6 = [
  "add_scene_to_cart",
  "get_scene",
  "get_selection",
  "move_object",
  "replace_object",
  "search_products",
] as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "modelContext");
});

test("connects the Core 6 journey to the shared Scene and approval UI", async () => {
  const registrations: CapturedRegistration[] = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      async registerTool(
        tool: ModelContextTool,
        options?: { signal?: AbortSignal },
      ) {
        if (!options?.signal) throw new Error("Expected a registration signal");
        registrations.push({ signal: options.signal, tool });
      },
    },
  });
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const { unmount } = render(<DemoWorkspace />);

  await waitFor(() => expect(registrations).toHaveLength(6));
  expect(registrations.map(({ tool }) => tool.name).sort()).toEqual([
    ...CORE_6,
  ]);
  expect(
    screen.getByRole("status", { name: "Native WebMCP status" }),
  ).toHaveTextContent("Available");
  const tool = (name: ModelContextTool["name"]) => {
    const descriptor = registrations.find(
      (registration) => registration.tool.name === name,
    )?.tool;
    if (!descriptor) throw new Error(`Missing ${name}`);
    return descriptor;
  };

  const search = await tool("search_products").execute(
    { category: "coffee_table" },
    { signal: new AbortController().signal },
  );
  if (!search.structuredContent.ok) throw new Error("Expected search success");
  const results = (
    search.structuredContent.data as {
      results: Array<{ id: string }>;
    }
  ).results;

  await act(async () => {
    await tool("replace_object").execute(
      {
        productId: results[1]?.id,
        expectedRevision: 1,
        expectedStateVersion: 1,
      },
      { signal: new AbortController().signal },
    );
  });
  expect(
    screen.getByRole("status", { name: "Scene diagnostics" }),
  ).toHaveTextContent(
    "Revision 2 · table_01 · travertine-plinth-table",
  );

  await act(async () => {
    await tool("add_scene_to_cart").execute(
      { expectedRevision: 2, expectedStateVersion: 2 },
      { signal: new AbortController().signal },
    );
  });
  const sheet = screen.getByRole("dialog", { name: "Review your room" });
  expect(within(sheet).getAllByRole("listitem")).toHaveLength(1);
  expect(within(sheet).getByText("Travertine Plinth Table")).toBeVisible();
  expect(within(sheet).getByText("$249 USD")).toBeVisible();
  expect(within(sheet).getByText(/Scene revision 2/)).toBeVisible();
  expect(fetchSpy).not.toHaveBeenCalled();

  unmount();
  expect(registrations.every(({ signal }) => signal.aborted)).toBe(true);
});

test("moves from object inspection to product preview", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  expect(
    screen.getByRole("heading", { name: "Object inspector" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Find alternatives" }));

  const products = screen.getByRole("region", {
    name: "Coffee tables for your room",
  });
  expect(within(products).getAllByRole("article")).toHaveLength(3);

  await user.click(
    screen.getByRole("button", { name: "Preview Oak Frame Table" }),
  );
  expect(screen.getByText("Previewing Oak Frame Table")).toBeVisible();
  expect(screen.getByText("Revision 2")).toBeVisible();
  expect(screen.getAllByText("$169")).not.toHaveLength(0);
  expect(
    screen.getByRole("status", { name: "Scene diagnostics" }),
  ).toHaveTextContent("Revision 2 · table_01 · oak-frame-table");
});

test("exposes six photo controls and six object-rail controls", () => {
  render(<DemoWorkspace />);

  const stage = screen.getByRole("region", { name: "Editable room photo" });
  const objectRail = screen.getByRole("region", { name: "Objects in room" });
  expect(stage).toBeVisible();
  expect(objectRail).toBeVisible();
  expect(
    within(stage).getAllByRole("button", {
      name: /sofa|coffee table|rug|floor lamp|chair|plant/i,
    }),
  ).toHaveLength(6);
  expect(
    within(objectRail).getAllByRole("button", {
      name: /sofa|coffee table|rug|floor lamp|chair|plant/i,
    }),
  ).toHaveLength(6);
  expect(
    screen.queryByRole("button", { name: /run agent move/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Copy redesign prompt" }),
  ).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Native WebMCP status" }),
  ).toHaveTextContent("Unavailable");
});

test("arranges through Human UI and one Undo restores the Scene", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);
  const before = screen.getByRole("status", { name: "Scene diagnostics" }).textContent;

  await user.click(screen.getByRole("button", { name: "Arrange naturally" }));
  expect(screen.getByRole("status", { name: "Placement status" }))
    .toHaveTextContent("Placement improved");
  expect(screen.getByRole("button", { name: "Undo placement" })).toBeVisible();
  expect(screen.getByRole("status", { name: "Scene diagnostics" }).textContent)
    .not.toBe(before);

  await user.click(screen.getByRole("button", { name: "Undo placement" }));
  expect(screen.getByRole("status", { name: "Scene diagnostics" }).textContent)
    .toBe(before);
});

test("disables natural arrangement while a pointer transform is active", () => {
  render(<DemoWorkspace />);
  const stage = screen.getByRole("region", { name: "Editable room photo" });
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
    bottom: 550,
    height: 450,
    left: 100,
    right: 900,
    top: 100,
    width: 800,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });

  fireEvent.pointerDown(within(stage).getByRole("button", { name: "Coffee table" }), {
    pointerId: 1,
    clientX: 500,
    clientY: 300,
  });

  expect(screen.getByRole("button", { name: "Arrange naturally" })).toBeDisabled();
});

test("disables natural arrangement when every scene object is locked", () => {
  const scene = createDemoScene();
  for (const object of scene.objects) object.locked = true;
  const store = createSceneStore(scene);
  render(<DemoWorkspace store={store} />);

  expect(screen.getByRole("button", { name: "Arrange naturally" })).toBeDisabled();
});

test.each([
  {
    name: "an unchanged proposal",
    proposePlacement: () => ({
      kind: "unchanged" as const,
      reason: "already-safe" as const,
      diagnostics: { currentScore: 10, proposedScore: 10, evaluatedLayouts: 1 },
    }),
    message: "Current placement is already the safest option",
  },
  {
    name: "a failed proposal",
    proposePlacement: () => ({
      kind: "failed" as const,
      reason: "no-valid-layout" as const,
    }),
    message: "Could not improve placement; the room was left unchanged",
  },
])("shows the exact status and no Undo for $name", async ({ proposePlacement, message }) => {
  const user = userEvent.setup();
  const store = createSceneStore(completedProductScene(), { proposePlacement });
  const revision = store.getState().scene.revision;
  render(<DemoWorkspace store={store} />);

  await user.click(screen.getByRole("button", { name: "Arrange naturally" }));

  expect(screen.getByRole("status", { name: "Placement status" }))
    .toHaveTextContent(message);
  expect(screen.queryByRole("button", { name: "Undo placement" })).not.toBeInTheDocument();
  expect(store.getState().scene.revision).toBe(revision);
});

test("shows three alternatives for the selected chair category", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  const stage = screen.getByRole("region", { name: "Editable room photo" });
  await user.click(within(stage).getByRole("button", { name: "Chair" }));
  await user.click(screen.getByRole("button", { name: "Find alternatives" }));

  const products = screen.getByRole("region", {
    name: "Chairs for your room",
  });
  expect(within(products).getAllByRole("article")).toHaveLength(3);
  expect(within(products).getByText("Ash Lounge Chair")).toBeVisible();
  expect(within(products).getByText("Boucle Barrel Chair")).toBeVisible();
  expect(within(products).getByText("Cognac Sling Chair")).toBeVisible();
  expect(within(products).queryByText("Oak Frame Table")).not.toBeInTheDocument();
});

test("uses Scene selection without incrementing revision", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  const objectRail = screen.getByRole("region", { name: "Objects in room" });
  await user.click(within(objectRail).getByRole("button", { name: "Chair" }));

  expect(screen.getByText("Lounge chair")).toBeVisible();
  expect(screen.getByText("Revision 1")).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Scene diagnostics" }),
  ).toHaveTextContent("Revision 1 · chair_01 · placeholder");
});

test("opens a four-item approval sheet and confirms without an external cart request", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  const viewCart = screen.getByRole("button", { name: "View cart" });
  await user.click(viewCart);

  const sheet = screen.getByRole("dialog", { name: "Review your room" });
  expect(within(sheet).getAllByRole("listitem")).toHaveLength(4);
  expect(within(sheet).getByText("$626 USD")).toBeVisible();

  await user.click(
    within(sheet).getByRole("button", {
      name: "Continue to Shopify · $626",
    }),
  );

  expect(
    screen.queryByRole("dialog", { name: "Review your room" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Demo only — no external cart was created."),
  ).toBeVisible();
  expect(viewCart).toHaveFocus();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("keeps keyboard focus inside the cart approval sheet", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(screen.getByRole("button", { name: "View cart" }));

  const sheet = screen.getByRole("dialog", { name: "Review your room" });
  const close = within(sheet).getByRole("button", {
    name: "Close cart review",
  });
  const continueToShopify = within(sheet).getByRole("button", {
    name: "Continue to Shopify · $626",
  });
  const keepEditing = within(sheet).getByRole("button", {
    name: "Keep editing",
  });

  expect(close).toHaveFocus();
  await user.tab();
  expect(continueToShopify).toHaveFocus();
  await user.tab();
  expect(keepEditing).toHaveFocus();
  await user.tab();
  expect(close).toHaveFocus();
});

test("hides the workspace from assistive technology and restores the cart trigger on close", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  const viewCart = screen.getByRole("button", { name: "View cart" });
  await user.click(viewCart);

  expect(
    screen.queryByRole("button", { name: "Run Agent move" }),
  ).not.toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "Close cart review" }),
  );
  expect(viewCart).toHaveFocus();
});

test("Escape closes the cart before clearing the selected object", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  const objectRail = screen.getByRole("region", { name: "Objects in room" });
  const coffeeTable = within(objectRail).getByRole("button", {
    name: "Coffee table",
  });
  expect(coffeeTable).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: "View cart" }));
  await user.keyboard("{Escape}");
  expect(
    screen.queryByRole("dialog", { name: "Review your room" }),
  ).not.toBeInTheDocument();
  expect(coffeeTable).toHaveAttribute("aria-pressed", "true");

  await user.keyboard("{Escape}");
  expect(coffeeTable).toHaveAttribute("aria-pressed", "false");
});

test("activates move and rotate tools for Scene transforms", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  const select = screen.getByRole("button", { name: "Select tool" });
  const move = screen.getByRole("button", { name: "Move tool" });
  const rotate = screen.getByRole("button", { name: "Rotate tool" });

  expect(select).toHaveAttribute("aria-pressed", "true");
  expect(move).toBeEnabled();
  expect(rotate).toBeEnabled();

  await user.click(move);
  expect(move).toHaveAttribute("aria-pressed", "true");
  expect(select).toHaveAttribute("aria-pressed", "false");

  await user.click(rotate);
  expect(rotate).toHaveAttribute("aria-pressed", "true");
  expect(move).toHaveAttribute("aria-pressed", "false");
});

test("copies prompt guidance without changing Scene revision or state version", async () => {
  const registrations: CapturedRegistration[] = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      async registerTool(
        tool: ModelContextTool,
        options?: { signal?: AbortSignal },
      ) {
        if (!options?.signal) throw new Error("Expected a registration signal");
        registrations.push({ signal: options.signal, tool });
      },
    },
  });
  const user = userEvent.setup();
  const writeText = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  render(<DemoWorkspace />);
  await waitFor(() => expect(registrations).toHaveLength(6));
  const getScene = registrations.find(
    ({ tool }) => tool.name === "get_scene",
  )?.tool;
  if (!getScene) throw new Error("Missing get_scene");
  const signal = new AbortController().signal;
  const before = await getScene.execute({}, { signal });

  await user.click(
    screen.getByRole("button", { name: "Copy redesign prompt" }),
  );

  expect(writeText).toHaveBeenCalledWith(
    "Redesign this room as a warm minimal Japandi interior. Replace every outdated unlocked item with a coherent catalog result, keep the sofa on the left, and leave a clear path to the windows. Read the latest scene after each change.",
  );
  expect(screen.getByRole("status", { name: "Prompt copy status" }))
    .toHaveTextContent("Prompt copied");
  expect(screen.getByText("Prompt copied")).toBeVisible();
  const after = await getScene.execute({}, { signal });
  expect(after.structuredContent.sceneRevision).toBe(
    before.structuredContent.sceneRevision,
  );
  expect(after.structuredContent.stateVersion).toBe(
    before.structuredContent.stateVersion,
  );
});

test("reports rejected prompt copies without changing Scene revision or state version", async () => {
  const registrations: CapturedRegistration[] = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      async registerTool(
        tool: ModelContextTool,
        options?: { signal?: AbortSignal },
      ) {
        if (!options?.signal) throw new Error("Expected a registration signal");
        registrations.push({ signal: options.signal, tool });
      },
    },
  });
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(
    new DOMException("Denied", "NotAllowedError"),
  );
  render(<DemoWorkspace />);
  await waitFor(() => expect(registrations).toHaveLength(6));
  const getScene = registrations.find(
    ({ tool }) => tool.name === "get_scene",
  )?.tool;
  if (!getScene) throw new Error("Missing get_scene");
  const signal = new AbortController().signal;
  const before = await getScene.execute({}, { signal });

  await user.click(
    screen.getByRole("button", { name: "Copy redesign prompt" }),
  );

  expect(screen.getByRole("status", { name: "Prompt copy status" }))
    .toHaveTextContent("Could not copy. Select and copy the prompt manually.");
  const after = await getScene.execute({}, { signal });
  expect(after.structuredContent.sceneRevision).toBe(
    before.structuredContent.sceneRevision,
  );
  expect(after.structuredContent.stateVersion).toBe(
    before.structuredContent.stateVersion,
  );
});

test("keeps the latest copy result visible when attempts settle in reverse order", async () => {
  let rejectFirstCopy!: (reason?: unknown) => void;
  let resolveSecondCopy!: () => void;
  const firstCopy = new Promise<void>((_, reject) => {
    rejectFirstCopy = reject;
  });
  const secondCopy = new Promise<void>((resolve) => {
    resolveSecondCopy = resolve;
  });
  const user = userEvent.setup();
  const writeText = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockReturnValueOnce(firstCopy)
    .mockReturnValueOnce(secondCopy);
  render(<DemoWorkspace />);

  const copyPrompt = screen.getByRole("button", {
    name: "Copy redesign prompt",
  });
  await user.click(copyPrompt);
  await user.click(copyPrompt);
  expect(writeText).toHaveBeenCalledTimes(2);

  await act(async () => {
    resolveSecondCopy();
    await Promise.resolve();
  });
  expect(screen.getByRole("status", { name: "Prompt copy status" }))
    .toHaveTextContent("Prompt copied");

  await act(async () => {
    rejectFirstCopy(new DOMException("Denied", "NotAllowedError"));
    await Promise.resolve();
  });
  expect(screen.getByRole("status", { name: "Prompt copy status" }))
    .toHaveTextContent("Prompt copied");
});

test("Reset Demo restores the canonical inspector state", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(screen.getByRole("button", { name: "Find alternatives" }));
  await user.click(
    screen.getByRole("button", { name: "Preview Oak Frame Table" }),
  );
  await user.click(screen.getByRole("button", { name: "Reset Demo" }));

  expect(
    screen.getByRole("heading", { name: "Object inspector" }),
  ).toBeVisible();
  expect(screen.getByText("Revision 1")).toBeVisible();
  expect(screen.getByText("$0")).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Scene diagnostics" }),
  ).toHaveTextContent("Revision 1 · table_01 · placeholder");
  expect(
    screen.queryByText("Previewing Oak Frame Table"),
  ).not.toBeInTheDocument();
});
