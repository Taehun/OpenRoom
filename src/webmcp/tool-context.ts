import { z } from "zod";

import {
  SceneProductSchema,
  type CommandRequest,
  type CommandResult,
  type Scene,
  type SceneObject,
  type SceneProduct,
} from "../features/scene/scene-schema";
import type {
  CommerceContext,
  CommerceDraft,
} from "../features/commerce/commerce-types";
import type { SearchProductsInput } from "./tool-contracts";

export const CatalogProductSchema = SceneProductSchema.extend({
  description: z.string().max(500).trim().min(1),
}).strict();

export type CatalogProduct = z.infer<typeof CatalogProductSchema>;

export interface CartApprovalItem {
  objectId: string;
  productId: string;
  variantId: string;
  title: string;
  quantity: 1;
  price: SceneProduct["price"];
}

export interface CartApprovalDraft {
  id: string;
  sceneId: string;
  sceneRevision: number;
  items: readonly CartApprovalItem[];
  totalMinor: number;
  commerce?: CommerceDraft;
}

export interface ToolContext {
  getScene(): Scene;
  getStateVersion(): number;
  getSelection(): SceneObject | null;
  searchProducts(input: SearchProductsInput): readonly CatalogProduct[];
  resolveProduct(productId: string): CatalogProduct | undefined;
  applyCommand(request: CommandRequest): CommandResult;
  openCartApproval(draft: CartApprovalDraft): void;
  commerce: CommerceContext;
}
