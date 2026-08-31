import type { ToolContext } from "./tool-context";
import { createCoreTools, type ModelContextTool } from "./tool-handlers";

export interface ModelContext {
  registerTool(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal; exposedTo?: readonly string[] },
  ): Promise<void>;
}

export interface WebMcpRegistration {
  ready: Promise<void>;
  unregister(): void;
}

export function registerWebMcpTools(
  modelContext: ModelContext,
  context: ToolContext,
): WebMcpRegistration {
  const controller = new AbortController();
  let unregistered = false;
  const unregister = () => {
    if (unregistered) return;
    unregistered = true;
    controller.abort();
  };
  const ready = Promise.all(
    createCoreTools(context).map((tool) =>
      modelContext.registerTool(tool, { signal: controller.signal }),
    ),
  ).then(() => undefined).catch((error: unknown) => {
    unregister();
    throw error;
  });

  return { ready, unregister };
}

function isModelContext(value: unknown): value is ModelContext {
  return typeof value === "object" &&
    value !== null &&
    "registerTool" in value &&
    typeof value.registerTool === "function";
}

export function getDocumentModelContext(): ModelContext | null {
  if (typeof document === "undefined" || !("modelContext" in document)) {
    return null;
  }

  const modelContext = (document as Document & { modelContext?: unknown })
    .modelContext;
  return isModelContext(modelContext) ? modelContext : null;
}
