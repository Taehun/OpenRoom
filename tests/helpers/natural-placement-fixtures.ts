import { createDemoScene } from "../../src/demo/demo-scene";
import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import {
  SceneSchema,
  type Scene,
} from "../../src/features/scene/scene-schema";

/**
 * Width of the fixture room. The placement solver and the pinned projection numbers
 * were measured in the original 6 m demo room; the calibrated 3.4 m photo room is too
 * tight for the solver to arrange all six products, so fixtures keep the roomier floor
 * unless a test asks for the real seed width.
 */
export const FIXTURE_ROOM_WIDTH_M = 6;

export function completedProductScene({
  widthM = FIXTURE_ROOM_WIDTH_M,
}: { widthM?: number } = {}): Scene {
  const scene = structuredClone(createDemoScene({ widthM }));
  for (const object of scene.objects) {
    const product = DEMO_PRODUCTS.find(({ category }) => category === object.type);
    if (!product) throw new Error(`Missing product for ${object.type}`);
    object.source = "product";
    object.assetId = product.id;
    object.product = {
      id: product.id,
      variantId: product.variantId,
      title: product.title,
      category: product.category,
      price: structuredClone(product.price),
      dimensionsCm: structuredClone(product.dimensionsCm),
      styleTags: [...product.styleTags],
      color: product.color,
      material: product.material,
    };
    object.dimensionsM = {
      width: product.dimensionsCm.width / 100,
      height: product.dimensionsCm.height / 100,
      depth: product.dimensionsCm.depth / 100,
    };
    object.position[1] = object.type === "rug" ? 0.01 : object.dimensionsM.height / 2;
  }
  return SceneSchema.parse(scene);
}
