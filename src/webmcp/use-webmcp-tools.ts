"use client";

import { useEffect } from "react";

import type { ToolContext } from "./tool-context";
import { getDocumentModelContext, registerWebMcpTools } from "./register-tools";

function isAbortError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError";
}

export function useWebMcpTools(context: ToolContext): void {
  useEffect(() => {
    const modelContext = getDocumentModelContext();
    if (modelContext === null) return;

    const registration = registerWebMcpTools(modelContext, context);
    let cleanedUp = false;
    void registration.ready.catch((error: unknown) => {
      if (!cleanedUp && !isAbortError(error)) {
        console.error("Failed to register WebMCP tools.", error);
      }
    });

    return () => {
      cleanedUp = true;
      registration.unregister();
    };
  }, [context]);
}
