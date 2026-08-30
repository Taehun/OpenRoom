export type DemoMode = "inspector" | "products" | "activity";

export interface DemoProduct {
  id: string;
  name: string;
  priceMinor: number;
  description: string;
}

export interface DemoCartItem {
  id: string;
  name: string;
  priceMinor: number;
}

export interface DemoToast {
  message: string;
}

export interface DemoHistorySnapshot {
  mode: DemoMode;
  revision: number;
  selectedObjectId: string | null;
  previewProductId: string | null;
  isCartOpen: boolean;
  provider: string;
  roomTotalMinor: number;
  toast: DemoToast | null;
  announcement: string | null;
}

export interface DemoState extends DemoHistorySnapshot {
  history: DemoHistorySnapshot | null;
}

export type DemoAction =
  | { type: "show-products" }
  | { type: "show-inspector" }
  | { type: "show-activity" }
  | { type: "select-object"; objectId: string | null }
  | { type: "preview-product"; productId: string }
  | { type: "run-agent-move" }
  | { type: "open-cart" }
  | { type: "close-cart" }
  | { type: "confirm-demo-cart" }
  | { type: "undo" }
  | { type: "reset" };
