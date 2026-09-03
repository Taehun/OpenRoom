import {
  ADD_SCENE_TO_CART_JSON_SCHEMA,
  GET_SCENE_JSON_SCHEMA,
  GET_SELECTION_JSON_SCHEMA,
  MOVE_OBJECT_JSON_SCHEMA,
  REPLACE_OBJECT_JSON_SCHEMA,
  SEARCH_PRODUCTS_JSON_SCHEMA,
  type CoreToolName,
} from "./tool-contracts";

export interface CoreToolManifestEntry {
  name: CoreToolName;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
}

/**
 * Recursively freezes the manifest at module load: descriptors handed to a
 * `document.modelContext` host alias this state, and a host mutation must not
 * be able to change `canonicalManifestJson()` or the pairing hash mid-session.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export const CORE_TOOL_MANIFEST = deepFreeze([
  {
    name: "get_scene",
    description:
      "Return the current validated Scene; each object includes a derived unit facing vector {x, z} ({x:0,z:1} faces the camera side).",
    inputSchema: GET_SCENE_JSON_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: "get_selection",
    description:
      "Return the currently selected Scene object, including its derived unit facing vector {x, z} ({x:0,z:1} faces the camera side).",
    inputSchema: GET_SELECTION_JSON_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: "search_products",
    description: "Search the local product catalog in deterministic order.",
    inputSchema: SEARCH_PRODUCTS_JSON_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: "replace_object",
    description: "Replace an explicit or selected Scene object with a catalog product.",
    inputSchema: REPLACE_OBJECT_JSON_SCHEMA,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  },
  {
    name: "move_object",
    description:
      "Move an explicit or selected Scene object; orient it with rotationYDegrees or a facing vector {x, z}.",
    inputSchema: MOVE_OBJECT_JSON_SCHEMA,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  },
  {
    name: "add_scene_to_cart",
    description: "Open a local approval draft for product-backed Scene objects.",
    inputSchema: ADD_SCENE_TO_CART_JSON_SCHEMA,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  },
] as const satisfies readonly CoreToolManifestEntry[]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .map((key) => [key, canonicalize(source[key])]),
  );
}

/**
 * Serializes the manifest with recursively sorted object keys so both adapters
 * derive the same bytes regardless of property insertion order.
 */
export function canonicalManifestJson(): string {
  return JSON.stringify(canonicalize(CORE_TOOL_MANIFEST));
}

/** SHA-256 of the canonical manifest bytes, lowercase hex. */
export async function getCoreToolManifestHash(): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalManifestJson());
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
