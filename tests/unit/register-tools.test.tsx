import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createSceneStore } from "../../src/features/scene/scene-store";
import { CORE_TOOL_MANIFEST } from "../../src/webmcp/core-tool-manifest";
import { CORE_TOOL_NAMES } from "../../src/webmcp/tool-contracts";
import type { ToolContext } from "../../src/webmcp/tool-context";
import { UNCONFIGURED_COMMERCE } from "../helpers/commerce-fixtures";
import type { ModelContextTool } from "../../src/webmcp/tool-handlers";
import {
  getDocumentModelContext,
  registerWebMcpTools,
  type ModelContext,
} from "../../src/webmcp/register-tools";
import { useWebMcpTools } from "../../src/webmcp/use-webmcp-tools";

interface Registration {
  name: string;
  signal: AbortSignal;
}

interface RegistrationFailure {
  name: string;
  error: Error;
}

class FakeModelContext implements ModelContext {
  readonly activeNames = new Set<string>();
  readonly registrations: Registration[] = [];
  readonly tools: ModelContextTool[] = [];

  constructor(private readonly failure?: RegistrationFailure) {}

  async registerTool(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal; exposedTo?: readonly string[] },
  ): Promise<void> {
    const signal = options?.signal;
    if (!signal) throw new Error("Expected a registration signal.");
    if (this.activeNames.has(tool.name)) {
      throw new Error(`Tool ${tool.name} is already active.`);
    }

    this.activeNames.add(tool.name);
    this.registrations.push({ name: tool.name, signal });
    this.tools.push(tool);
    const removeName = () => this.activeNames.delete(tool.name);
    signal.addEventListener("abort", removeName, { once: true });
    if (signal.aborted) removeName();

    if (this.failure?.name === tool.name) throw this.failure.error;
  }
}

class DeferredFailureModelContext extends FakeModelContext {
  readonly pending: Promise<void>[] = [];

  constructor(private readonly rejection: Promise<never>) {
    super();
  }

  override registerTool(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal; exposedTo?: readonly string[] },
  ): Promise<void> {
    const pending = this.waitThenReject(tool, options);
    this.pending.push(pending);
    return pending;
  }

  private async waitThenReject(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal; exposedTo?: readonly string[] },
  ): Promise<void> {
    await super.registerTool(tool, options);
    await this.rejection;
  }
}

function createToolContext(): ToolContext {
  const store = createSceneStore();
  return {
    getScene: () => store.getState().scene,
    getStateVersion: () => store.getState().stateVersion,
    getSelection: () => null,
    searchProducts: () => [],
    resolveProduct: () => undefined,
    applyCommand: (request) => store.getState().applyCommand(request),
    openCartApproval: () => undefined,
    commerce: UNCONFIGURED_COMMERCE,
  };
}

function installModelContext(modelContext: unknown) {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: modelContext,
  });
}

function WebMcpHarness({ context }: { context: ToolContext }) {
  useWebMcpTools(context);
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
  vi.restoreAllMocks();
});

describe("WebMCP registration lifecycle", () => {
  test("registers the Core 6 and aborts their shared lifetime on unregister", async () => {
    const modelContext = new FakeModelContext();
    const registration = registerWebMcpTools(modelContext, createToolContext());

    await registration.ready;
    expect([...modelContext.activeNames]).toEqual(CORE_TOOL_NAMES);
    expect(modelContext.registrations).toHaveLength(6);

    registration.unregister();
    registration.unregister();

    expect(modelContext.activeNames.size).toBe(0);
    expect(modelContext.registrations.every(({ signal }) => signal.aborted)).toBe(
      true,
    );
  });

  test("registers descriptors built from the shared Core 6 manifest", async () => {
    const modelContext = new FakeModelContext();
    const registration = registerWebMcpTools(modelContext, createToolContext());

    await registration.ready;
    expect(
      modelContext.tools.map(({ name, description, inputSchema, annotations }) => ({
        name,
        description,
        inputSchema,
        annotations,
      })),
    ).toEqual(CORE_TOOL_MANIFEST);
    expect(
      modelContext.tools.every(({ execute }) => typeof execute === "function"),
    ).toBe(true);

    registration.unregister();
  });

  test("aborts every tool when a registration fails", async () => {
    const modelContext = new FakeModelContext({
      name: "replace_object",
      error: new Error("Registration rejected."),
    });
    const registration = registerWebMcpTools(modelContext, createToolContext());

    await expect(registration.ready).rejects.toThrow("Registration rejected.");

    expect(modelContext.activeNames.size).toBe(0);
    expect(modelContext.registrations).toHaveLength(6);
    expect(modelContext.registrations.every(({ signal }) => signal.aborted)).toBe(
      true,
    );
  });

  test("returns only a usable document model context", () => {
    expect(getDocumentModelContext()).toBeNull();

    const modelContext = new FakeModelContext();
    installModelContext(modelContext);
    expect(getDocumentModelContext()).toBe(modelContext);

    installModelContext({ registerTool: "not a function" });
    expect(getDocumentModelContext()).toBeNull();

    vi.stubGlobal("document", undefined);
    expect(getDocumentModelContext()).toBeNull();
  });

  test("the hook skips unavailable support and retains one registration set across rerenders", async () => {
    const context = createToolContext();
    const unsupported = render(<WebMcpHarness context={context} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getDocumentModelContext()).toBeNull();
    unsupported.unmount();

    const modelContext = new FakeModelContext();
    installModelContext(modelContext);
    const mounted = render(<WebMcpHarness context={context} />);

    await waitFor(() => {
      expect(modelContext.activeNames.size).toBe(6);
    });
    mounted.rerender(<WebMcpHarness context={context} />);

    expect(modelContext.registrations).toHaveLength(6);
    mounted.unmount();
    expect(modelContext.activeNames.size).toBe(0);
    expect(modelContext.registrations.every(({ signal }) => signal.aborted)).toBe(
      true,
    );
  });

  test("the hook reports one live non-abort registration failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    installModelContext(new FakeModelContext({
      name: "replace_object",
      error: new Error("Registration rejected."),
    }));

    render(<WebMcpHarness context={createToolContext()} />);

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  test("the hook suppresses a registration rejection after intentional unmount", async () => {
    let rejectFailure: (error: Error) => void = () => undefined;
    const failure = new Promise<never>((_resolve, reject) => {
      rejectFailure = reject;
    });
    const modelContext = new DeferredFailureModelContext(failure);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    installModelContext(modelContext);

    const mounted = render(<WebMcpHarness context={createToolContext()} />);
    await waitFor(() => {
      expect(modelContext.registrations).toHaveLength(6);
    });
    mounted.unmount();

    await act(async () => {
      rejectFailure(new Error("Registration rejected after cleanup."));
      await Promise.allSettled(modelContext.pending);
      await Promise.resolve();
    });

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
