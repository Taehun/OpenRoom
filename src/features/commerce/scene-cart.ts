import type { CartApprovalDraft } from "../../webmcp/tool-context";
import type { Scene, SceneObject } from "../scene/scene-schema";

/**
 * The single definition of "what the room costs": one line per product-backed
 * object, in Scene order. Both the `add_scene_to_cart` tool and the header's
 * "View cart" button build their draft here, so an agent and a human always see
 * the same cart for the same room.
 */
export function cartDraftForScene(
  scene: Scene,
  objects: readonly SceneObject[],
): CartApprovalDraft {
  const items = objects.flatMap((object) => {
    if (object.source !== "product" || !object.product) return [];
    return [{
      objectId: object.id,
      productId: object.product.id,
      demoVariantId: object.product.variantId,
      title: object.product.title,
      quantity: 1 as const,
      price: object.product.price,
    }];
  });

  return {
    id: `scene-${scene.id}-rev-${scene.revision}`,
    sceneId: scene.id,
    sceneRevision: scene.revision,
    items,
    totalMinor: items.reduce((total, item) => total + item.price.amountMinor, 0),
  };
}
