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
import { ContextPanel } from "../../src/features/demo/context-panel";
import { DemoWorkspace } from "../../src/features/demo/demo-workspace";
import type { ModelContextTool } from "../../src/webmcp/tool-handlers";
import {
  FakeRelayServer,
  RELAY_SESSION_TOKEN,
} from "../helpers/relay-server";

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
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
  expect(within(products).getAllByRole("article")).toHaveLength(5);

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
  // The natural-placement solver is an unwired library: no control invokes it and
  // the canvas top bar carries captions only.
  expect(
    screen.queryByRole("status", { name: "Placement status" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Copy redesign prompt" }),
  ).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Native WebMCP status" }),
  ).toHaveTextContent("Unavailable");
  expect(screen.queryByRole("link", { name: "Guide" })).toBeNull();
});

test("links the workspace header to the public repository", () => {
  render(<DemoWorkspace />);

  const repoLink = screen.getByRole("link", { name: "OpenRoom on GitHub" });
  expect(repoLink).toHaveAttribute("href", "https://github.com/Taehun/OpenRoom");
  expect(repoLink).toHaveAttribute("target", "_blank");
  expect(repoLink.getAttribute("rel")).toContain("noopener");
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
  expect(within(products).getAllByRole("article")).toHaveLength(5);
  expect(within(products).getByText("Ash Lounge Chair")).toBeVisible();
  expect(within(products).getByText("Boucle Barrel Chair")).toBeVisible();
  expect(within(products).getByText("Cognac Sling Chair")).toBeVisible();
  expect(within(products).getByText("Oak Paper Cord Chair")).toBeVisible();
  expect(within(products).getByText("Shearling Swivel Chair")).toBeVisible();
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
      name: "Approve demo cart · $626",
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
    name: "Approve demo cart · $626",
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

/**
 * Pairing is the same deliberate human act it always was — the operator copies
 * the code the companion prints and types it in — but the composer now shows
 * only a status chip and one button, and the fields live in a modal dialog.
 */
function openPairingDialog() {
  return screen.getByRole("button", { name: "Connect an AI app" });
}

test("shows the local agent status as a chip beside the native WebMCP status", () => {
  render(<DemoWorkspace />);

  expect(
    screen.getByRole("status", { name: "Native WebMCP status" }),
  ).toHaveTextContent("Native WebMCP: Unavailable");
  const chip = screen.getByRole("status", {
    name: "Local agent connection status",
  });
  expect(chip.textContent).toBe("Local agent: Not connected");

  // The composer row itself carries no fields any more.
  expect(openPairingDialog()).toBeVisible();
  expect(
    screen.queryByRole("dialog", { name: "Connect an AI app" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Disconnect" }),
  ).not.toBeInTheDocument();
});

test("opens a pairing dialog with the accessible code and port fields", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(openPairingDialog());

  const dialog = screen.getByRole("dialog", { name: "Connect an AI app" });
  expect(dialog).toBeVisible();
  expect(
    within(dialog).getByText(
      "Type the six-digit code the companion wrote to ~/openroom-mcp.log.",
    ),
  ).toBeVisible();

  const code = within(dialog).getByRole("textbox", { name: "Pairing code" });
  expect(code).toHaveAttribute("inputMode", "numeric");
  expect(code).toHaveAttribute("pattern", "[0-9]{6}");
  expect(code).toHaveAttribute("maxLength", "6");
  expect(code).toHaveAttribute("autoComplete", "off");
  expect(code).toHaveAccessibleDescription(
    "Type the six-digit code the companion wrote to ~/openroom-mcp.log.",
  );

  // The relay port is an expert setting, folded behind a closed disclosure.
  const advanced = within(dialog).getByText("Advanced").closest("details");
  expect(advanced).not.toBeNull();
  expect(advanced).not.toHaveAttribute("open");
  expect(within(dialog).getByLabelText("Relay port")).toHaveValue(43_110);

  expect(within(dialog).getByRole("button", { name: "Connect" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeVisible();
});

test("Cancel closes the pairing dialog without touching the relay", async () => {
  const server = new FakeRelayServer();
  vi.spyOn(globalThis, "fetch").mockImplementation(server.fetch);
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(openPairingDialog());
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Connect an AI app" }),
    ).getByRole("button", { name: "Cancel" }),
  );

  expect(
    screen.queryByRole("dialog", { name: "Connect an AI app" }),
  ).not.toBeInTheDocument();
  expect(server.requests).toHaveLength(0);
});

test("enables Connect only for exactly six digits", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);
  await user.click(openPairingDialog());

  const dialog = screen.getByRole("dialog", { name: "Connect an AI app" });
  const connect = within(dialog).getByRole("button", { name: "Connect" });
  const code = within(dialog).getByRole("textbox", { name: "Pairing code" });

  await user.type(code, "12345");
  expect(connect).toBeDisabled();

  await user.type(code, "6");
  expect(connect).toBeEnabled();

  await user.clear(code);
  await user.type(code, "abcdef");
  expect(code).toHaveValue("");
  expect(connect).toBeDisabled();
});

test("pairs with the local relay from the dialog without exposing the session token", async () => {
  const server = new FakeRelayServer();
  vi.spyOn(globalThis, "fetch").mockImplementation(server.fetch);
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(openPairingDialog());
  const dialog = screen.getByRole("dialog", { name: "Connect an AI app" });
  await user.type(
    within(dialog).getByRole("textbox", { name: "Pairing code" }),
    "123456",
  );
  await user.click(within(dialog).getByRole("button", { name: "Connect" }));

  await waitFor(() =>
    expect(
      screen.getByRole("status", { name: "Local agent connection status" })
        .textContent,
    ).toBe("Local agent: Connected"),
  );
  // A successful pair closes the dialog and hands the composer back.
  expect(
    screen.queryByRole("dialog", { name: "Connect an AI app" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
  expect(document.body.innerHTML).not.toContain(RELAY_SESSION_TOKEN);
  expect(window.location.href).not.toContain(RELAY_SESSION_TOKEN);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(screen.getByLabelText("Pairing code")).toHaveValue("");

  await user.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(
    screen.getByRole("status", { name: "Local agent connection status" })
      .textContent,
  ).toBe("Local agent: Not connected");
  expect(server.deletes).toHaveLength(1);
});

test("keeps a rejected pairing inside the dialog", async () => {
  const server = new FakeRelayServer();
  server.pairStatus = 403;
  vi.spyOn(globalThis, "fetch").mockImplementation(server.fetch);
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(openPairingDialog());
  const dialog = screen.getByRole("dialog", { name: "Connect an AI app" });
  await user.type(
    within(dialog).getByRole("textbox", { name: "Pairing code" }),
    "123456",
  );
  await user.click(within(dialog).getByRole("button", { name: "Connect" }));

  await waitFor(() =>
    expect(
      within(dialog).getByText(
        "Pairing was rejected. Check the code and try again.",
      ),
    ).toBeVisible(),
  );
  expect(dialog).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Local agent connection status" })
      .textContent,
  ).toBe("Local agent: Not connected");
});

test("clears a stale failure and the code when the dialog is reopened", async () => {
  const server = new FakeRelayServer();
  server.pairStatus = 403;
  vi.spyOn(globalThis, "fetch").mockImplementation(server.fetch);
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  await user.click(openPairingDialog());
  const dialog = screen.getByRole("dialog", { name: "Connect an AI app" });
  await user.type(
    within(dialog).getByRole("textbox", { name: "Pairing code" }),
    "123456",
  );
  await user.click(within(dialog).getByRole("button", { name: "Connect" }));
  await waitFor(() =>
    expect(
      within(dialog).getByText(
        "Pairing was rejected. Check the code and try again.",
      ),
    ).toBeVisible(),
  );

  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await user.click(openPairingDialog());

  const reopened = screen.getByRole("dialog", { name: "Connect an AI app" });
  expect(
    within(reopened).queryByText(
      "Pairing was rejected. Check the code and try again.",
    ),
  ).not.toBeInTheDocument();
  expect(
    within(reopened).getByRole("textbox", { name: "Pairing code" }),
  ).toHaveValue("");
  expect(within(reopened).getByRole("button", { name: "Connect" })).toBeDisabled();
});

test("explains an insecure context instead of pairing", async () => {
  const server = new FakeRelayServer();
  vi.spyOn(globalThis, "fetch").mockImplementation(server.fetch);
  const user = userEvent.setup();
  render(<DemoWorkspace />);
  await user.click(openPairingDialog());
  const dialog = screen.getByRole("dialog", { name: "Connect an AI app" });
  await user.type(
    within(dialog).getByRole("textbox", { name: "Pairing code" }),
    "123456",
  );
  vi.stubGlobal("crypto", {});

  await user.click(within(dialog).getByRole("button", { name: "Connect" }));

  expect(
    within(dialog).getByText("Pairing needs HTTPS or localhost."),
  ).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Local agent connection status" })
      .textContent,
  ).toBe("Local agent: Not connected");
  expect(server.requests).toHaveLength(0);
});

// The seed table sits at x = 0, so the front-quarter tie resolves to the
// photographed cutout and the inspector has to name that view.
test("discloses the selected object's facing and chosen view", async () => {
  const user = userEvent.setup();
  render(<DemoWorkspace />);

  const inspector = screen
    .getByRole("heading", { name: "Object inspector" })
    .closest("section");
  if (!inspector) throw new Error("Missing inspector section");
  const facing = within(inspector).getByText("Facing").nextElementSibling;
  expect(facing).toHaveTextContent("x 0.00 · z 1.00 · front-quarter");
  expect(facing?.textContent).not.toContain("mirrored");
  expect(within(inspector).getByText("Rotation")).toBeVisible();

  const stage = screen.getByRole("region", { name: "Editable room photo" });
  const sofa = within(stage).getByRole("button", { name: "Sofa" });
  await user.click(sofa);
  const sofaFacing = within(inspector).getByText("Facing").nextElementSibling;
  expect(sofaFacing).toHaveTextContent("x 0.00 · z 1.00 · front-quarter");
  expect(sofaFacing?.textContent).not.toContain("mirrored");

  // Six Shift steps turn the sofa 90°, further than the front-quarter pair can
  // show truthfully, so the inspector has to say the view is approximate.
  await user.click(screen.getByRole("button", { name: "Rotate tool" }));
  for (let step = 0; step < 6; step += 1) {
    fireEvent.keyDown(sofa, { key: "ArrowRight", shiftKey: true });
  }
  expect(within(inspector).getByText("Facing").nextElementSibling)
    .toHaveTextContent(
      "x −1.00 · z 0.00 · front-quarter · mirrored · approximate",
    );
});

// Spec §5: the inspector names the object a lamp stands on, and says nothing at all
// when it stands on the floor.
test("shows an On row only while the selected object is supported", () => {
  const state = {
    mode: "inspector" as const,
    isCartOpen: false,
    cartDraft: null,
    toast: null,
    announcement: null,
  };
  const floorScene = createDemoScene();
  floorScene.selectedObjectId = "lamp_01";

  const { unmount } = render(
    <ContextPanel dispatch={() => {}} scene={floorScene} state={state} />,
  );
  expect(screen.queryByText("On")).toBeNull();
  unmount();

  const stackedScene = createDemoScene();
  stackedScene.selectedObjectId = "lamp_01";
  const table = stackedScene.objects.find(({ id }) => id === "table_01")!;
  const lamp = stackedScene.objects.find(({ id }) => id === "lamp_01")!;
  lamp.position = [
    table.position[0],
    table.dimensionsM.height + lamp.dimensionsM.height / 2,
    table.position[2],
  ];

  render(<ContextPanel dispatch={() => {}} scene={stackedScene} state={state} />);
  expect(screen.getByText("On").nextElementSibling).toHaveTextContent(
    "Coffee table",
  );
});
