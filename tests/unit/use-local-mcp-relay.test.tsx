import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import { createDemoScene } from "../../src/demo/demo-scene";
import { createSceneStore, type SceneStore } from "../../src/features/scene/scene-store";
import type { CommandRequest, Scene } from "../../src/features/scene/scene-schema";
import type {
  CartApprovalDraft,
  ToolContext,
} from "../../src/webmcp/tool-context";
import {
  useLocalMcpRelay,
  type LocalMcpRelay,
} from "../../src/local-mcp/use-local-mcp-relay";
import { UNCONFIGURED_COMMERCE } from "../helpers/commerce-fixtures";
import {
  FakeRelayServer,
  RELAY_SESSION_TOKEN,
  postedResults,
} from "../helpers/relay-server";

interface Harness {
  context: ToolContext;
  drafts: CartApprovalDraft[];
  commands: CommandRequest[];
  store: SceneStore;
}

function createHarnessContext(scene?: Scene): Harness {
  const store = createSceneStore(scene);
  const drafts: CartApprovalDraft[] = [];
  const commands: CommandRequest[] = [];
  const context: ToolContext = {
    getScene: () => store.getState().scene,
    getStateVersion: () => store.getState().stateVersion,
    getSelection: () => {
      const { scene: current } = store.getState();
      return (
        current.objects.find(({ id }) => id === current.selectedObjectId) ?? null
      );
    },
    searchProducts: ({ category, limit }) =>
      DEMO_PRODUCTS.filter(
        (product) => category === undefined || product.category === category,
      ).slice(0, limit),
    resolveProduct: (productId) =>
      DEMO_PRODUCTS.find((product) => product.id === productId),
    applyCommand: (request) => {
      commands.push(request);
      return store.getState().applyCommand(request);
    },
    openCartApproval: (draft) => {
      drafts.push(draft);
    },
    commerce: UNCONFIGURED_COMMERCE,
  };

  return { context, drafts, commands, store };
}

function RelayHarness({
  context,
  fetchImpl,
  relayRef,
}: {
  context: ToolContext;
  fetchImpl: typeof fetch;
  relayRef: { current: LocalMcpRelay | null };
}) {
  const relay = useLocalMcpRelay(context, { fetchImpl });
  useEffect(() => {
    relayRef.current = relay;
  }, [relay, relayRef]);
  return null;
}

async function pairPage(harness: Harness) {
  const server = new FakeRelayServer();
  const relayRef: { current: LocalMcpRelay | null } = { current: null };
  const view = render(
    <RelayHarness
      context={harness.context}
      fetchImpl={server.fetch}
      relayRef={relayRef}
    />,
  );

  await act(async () => {
    await relayRef.current?.pair("123456");
  });
  await act(async () => {
    await server.waitForPoll();
  });

  const relay = () => {
    const relay = relayRef.current;
    if (!relay) throw new Error("Expected a mounted relay");
    return relay;
  };
  const deliver = async (call: unknown) => {
    await act(async () => {
      await server.deliver(call);
    });
  };

  return { deliver, relay, server, unmount: view.unmount };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("runs the Core 6 descriptors against the live Scene store", async () => {
  const harness = createHarnessContext();
  const { deliver, server, relay, unmount } = await pairPage(harness);

  expect(relay().status).toBe("connected");

  await deliver({ requestId: "req-get-scene-0001", toolName: "get_scene", input: {} });
  expect(postedResults(server)[0]?.result.structuredContent.ok).toBe(true);

  await deliver({
    requestId: "req-move-object-001",
    toolName: "move_object",
    input: {
      objectId: "lamp_01",
      position: { x: 0, z: 0 },
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
  });
  expect(harness.store.getState().scene.revision).toBe(2);
  expect(postedResults(server)).toHaveLength(2);
  expect(postedResults(server)[1]?.result.structuredContent.ok).toBe(true);

  unmount();
});

test("never executes a redelivered request id twice", async () => {
  const harness = createHarnessContext();
  const { deliver, server, unmount } = await pairPage(harness);
  const move = {
    requestId: "req-move-object-001",
    toolName: "move_object",
    input: {
      objectId: "lamp_01",
      position: { x: 0, z: 0 },
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
  };

  await deliver(move);
  await deliver(move);

  expect(harness.store.getState().scene.revision).toBe(2);
  expect(harness.commands).toHaveLength(1);
  const posted = postedResults(server);
  expect(posted).toHaveLength(2);
  expect(posted[1]).toEqual(posted[0]);

  unmount();
});

test("keeps a stale move a structured revision conflict", async () => {
  const harness = createHarnessContext();
  const { deliver, server, unmount } = await pairPage(harness);

  await deliver({
    requestId: "req-move-object-001",
    toolName: "move_object",
    input: {
      objectId: "lamp_01",
      position: { x: 0, z: 0 },
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
  });
  await deliver({
    requestId: "req-move-object-002",
    toolName: "move_object",
    input: {
      objectId: "lamp_01",
      position: { x: 0.4, z: 0.4 },
      expectedRevision: 1,
      expectedStateVersion: 2,
    },
  });

  const stale = postedResults(server)[1]?.result.structuredContent;
  expect(stale?.ok).toBe(false);
  expect(stale?.error?.code).toBe("SCENE_REVISION_CONFLICT");
  expect(harness.store.getState().scene.revision).toBe(2);

  unmount();
});

test("refuses to replace a locked object and leaves the Scene untouched", async () => {
  const scene = createDemoScene();
  const locked = scene.objects.find(({ id }) => id === "table_01");
  if (!locked) throw new Error("Expected the demo coffee table");
  locked.locked = true;
  const harness = createHarnessContext(scene);
  const { deliver, server, unmount } = await pairPage(harness);

  await deliver({
    requestId: "req-replace-locked-1",
    toolName: "replace_object",
    input: {
      objectId: "table_01",
      productId: "oak-frame-table",
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
  });

  const failure = postedResults(server)[0]?.result.structuredContent;
  expect(failure?.ok).toBe(false);
  expect(failure?.error?.code).toBe("OBJECT_LOCKED");
  expect(harness.store.getState().scene.revision).toBe(1);

  unmount();
});

test("opens a cart approval draft without mutating the Scene", async () => {
  const harness = createHarnessContext();
  const { deliver, server, unmount } = await pairPage(harness);

  await deliver({
    requestId: "req-replace-object-1",
    toolName: "replace_object",
    input: {
      objectId: "table_01",
      productId: "oak-frame-table",
      expectedRevision: 1,
      expectedStateVersion: 1,
    },
  });
  const commandsAfterReplace = harness.commands.length;

  await deliver({
    requestId: "req-add-to-cart-001",
    toolName: "add_scene_to_cart",
    input: { expectedRevision: 2, expectedStateVersion: 2 },
  });

  expect(postedResults(server)[1]?.result.structuredContent.ok).toBe(true);
  expect(harness.drafts).toHaveLength(1);
  expect(harness.drafts[0]?.items).toHaveLength(1);
  expect(harness.commands).toHaveLength(commandsAfterReplace);
  expect(harness.store.getState().scene.revision).toBe(2);

  unmount();
});

test("answers a tool outside the Core 6 with UNKNOWN_TOOL", async () => {
  const harness = createHarnessContext();
  const { deliver, server, unmount } = await pairPage(harness);

  await deliver({
    requestId: "req-unknown-tool-01",
    toolName: "drop_scene",
    input: {},
  });

  const failure = postedResults(server)[0]?.result.structuredContent;
  expect(failure?.ok).toBe(false);
  expect(failure?.error?.code).toBe("UNKNOWN_TOOL");
  expect(harness.commands).toHaveLength(0);

  unmount();
});

test("deletes the relay session once on unmount and starts no replacement poll", async () => {
  const harness = createHarnessContext();
  const { server, unmount } = await pairPage(harness);
  const pollsBefore = server.polls.length;

  await act(async () => {
    unmount();
    await Promise.resolve();
  });

  expect(server.deletes).toHaveLength(1);
  expect(server.deletes[0]?.headers.authorization).toBe(
    `Bearer ${RELAY_SESSION_TOKEN}`,
  );
  expect(server.deletes[0]?.keepalive).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(server.polls).toHaveLength(pollsBefore);
});

test("deletes the relay session when the page is hidden", async () => {
  const harness = createHarnessContext();
  const { server, unmount } = await pairPage(harness);

  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
  });

  expect(server.deletes).toHaveLength(1);
  unmount();
  expect(server.deletes).toHaveLength(1);
});

test("rejects pairing with INSECURE_CONTEXT when web crypto is unavailable", async () => {
  const harness = createHarnessContext();
  const server = new FakeRelayServer();
  const relayRef: { current: LocalMcpRelay | null } = { current: null };
  render(
    <RelayHarness
      context={harness.context}
      fetchImpl={server.fetch}
      relayRef={relayRef}
    />,
  );
  vi.stubGlobal("crypto", {});

  await act(async () => {
    await expect(relayRef.current?.pair("123456")).rejects.toMatchObject({
      code: "INSECURE_CONTEXT",
    });
  });

  expect(relayRef.current?.status).toBe("not-connected");
  expect(relayRef.current?.pairError).toBe("INSECURE_CONTEXT");
  expect(server.requests).toHaveLength(0);
});

test("keeps the relay port an explicit page control", async () => {
  const harness = createHarnessContext();
  const server = new FakeRelayServer();
  const relayRef: { current: LocalMcpRelay | null } = { current: null };
  render(
    <RelayHarness
      context={harness.context}
      fetchImpl={server.fetch}
      relayRef={relayRef}
    />,
  );

  expect(relayRef.current?.relayPort).toBe(43_110);
  await act(async () => {
    relayRef.current?.setRelayPort(43_999);
  });
  await act(async () => {
    await relayRef.current?.pair("123456");
  });

  expect(server.requests[0]?.url).toBe("http://127.0.0.1:43999/v1/pair");
  expect(window.location.search).toBe("");
});
