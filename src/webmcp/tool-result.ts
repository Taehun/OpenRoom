import type { ZodError, ZodIssue } from "zod";
import type { CoreToolName } from "./tool-contracts";
import type { SceneCommandErrorCode } from "../features/scene/scene-schema";

export type ToolErrorCode =
  | "INVALID_INPUT"
  | "NO_SELECTION"
  | "PRODUCT_NOT_FOUND"
  | "NO_CART_ITEMS"
  | SceneCommandErrorCode;

export type ToolIssue = { path: string; message: string };

export interface ToolSuccess<T> {
  ok: true;
  tool: CoreToolName;
  sceneRevision: number;
  data: T;
}

export interface ToolFailure {
  ok: false;
  tool: CoreToolName;
  sceneRevision: number;
  error: {
    code: ToolErrorCode;
    message: string;
    retryable: boolean;
    latestRevision?: number;
    issues?: ToolIssue[];
  };
}

export interface ToolResult<T> {
  content: [{ type: "text"; text: string }];
  structuredContent: ToolSuccess<T> | ToolFailure;
  isError?: true;
}

function textContent(text: string): [{ type: "text"; text: string }] {
  return [{ type: "text", text }];
}

export function toolSuccess<T>(
  tool: CoreToolName,
  sceneRevision: number,
  data: T,
  text = "Tool completed successfully.",
): ToolResult<T> {
  return {
    content: textContent(text),
    structuredContent: { ok: true, tool, sceneRevision, data },
  };
}

export type ToolErrorDetails = {
  latestRevision?: number;
  issues?: readonly (ToolIssue | ZodIssue)[];
};

function normalizeIssues(issues: readonly (ToolIssue | ZodIssue)[]): ToolIssue[] {
  return issues.map((issue) => ({
    path: typeof issue.path === "string" ? issue.path : issue.path.join(".") || "input",
    message: issue.message,
  }));
}

export function toolError(
  tool: CoreToolName,
  sceneRevision: number,
  code: ToolErrorCode,
  message: string,
  retryable: boolean,
  details?: ToolErrorDetails,
): ToolResult<never>;
export function toolError(
  tool: CoreToolName,
  sceneRevision: number,
  error: {
    code: ToolErrorCode;
    message: string;
    retryable: boolean;
    latestRevision?: number;
    issues?: readonly (ToolIssue | ZodIssue)[];
  },
): ToolResult<never>;
export function toolError(
  tool: CoreToolName,
  sceneRevision: number,
  codeOrError: ToolErrorCode | {
    code: ToolErrorCode;
    message: string;
    retryable: boolean;
    latestRevision?: number;
    issues?: readonly (ToolIssue | ZodIssue)[];
  },
  message?: string,
  retryable?: boolean,
  details?: ToolErrorDetails,
): ToolResult<never> {
  const error = typeof codeOrError === "string"
    ? {
        code: codeOrError,
        message: message ?? "Tool request failed.",
        retryable: retryable ?? false,
        ...details,
      }
    : codeOrError;
  const normalized = {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.latestRevision === undefined
      ? {}
      : { latestRevision: error.latestRevision }),
    ...(error.issues === undefined ? {} : { issues: normalizeIssues(error.issues) }),
  };
  return {
    content: textContent(error.message),
    structuredContent: { ok: false, tool, sceneRevision, error: normalized },
    isError: true,
  };
}

export function invalidInputResult(
  tool: CoreToolName,
  sceneRevision: number,
  error: ZodError,
): ToolResult<never> {
  return toolError(
    tool,
    sceneRevision,
    "INVALID_INPUT",
    "Input validation failed.",
    true,
    { issues: error.issues },
  );
}
