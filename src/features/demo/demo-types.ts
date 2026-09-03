import type { SceneProduct } from "../scene/scene-schema";
import type { CartApprovalDraft } from "../../webmcp/tool-context";

export type DemoMode = "inspector" | "products" | "activity";

export interface DemoProduct extends SceneProduct {
  description: string;
}

export interface DemoToast {
  message: string;
}

export interface DemoState {
  mode: DemoMode;
  isCartOpen: boolean;
  cartDraft: CartApprovalDraft | null;
  toast: DemoToast | null;
  announcement: string | null;
}

export type DemoAction =
  | { type: "show-products" }
  | { type: "show-inspector" }
  | { type: "show-activity" }
  | { type: "select-object"; objectId: string | null }
  | { type: "preview-product"; productId: string }
  | { type: "open-cart"; draft?: CartApprovalDraft }
  | { type: "close-cart" }
  | { type: "confirm-demo-cart" }
  | { type: "open-external-checkout"; itemCount: number }
  | { type: "undo" }
  | { type: "reset" };
