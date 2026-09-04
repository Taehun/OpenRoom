import type { SceneProduct } from "../scene/scene-schema";
import type { CartApprovalDraft } from "../../webmcp/tool-context";

export type DemoMode = "inspector" | "products" | "activity";

export interface DemoProduct extends SceneProduct {
  description: string;
}

export interface DemoToast {
  message: string;
}

/**
 * What the workspace says out loud after an action. `toast` is the visible
 * approval notice; `quiet` reaches the screen reader only, so an edit, an undo
 * or a reset is announced without covering the room. The nonce makes two
 * identical announcements two distinct states, so the second one restarts the
 * dismissal timer and is read again.
 */
export interface DemoAnnouncement {
  text: string;
  nonce: number;
  tone: "toast" | "quiet";
}

export interface DemoState {
  mode: DemoMode;
  isCartOpen: boolean;
  cartDraft: CartApprovalDraft | null;
  toast: DemoToast | null;
  announcement: DemoAnnouncement | null;
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
  | { type: "clear-announcement" }
  | { type: "open-external-checkout"; itemCount: number }
  | { type: "undo" }
  | { type: "reset" };
