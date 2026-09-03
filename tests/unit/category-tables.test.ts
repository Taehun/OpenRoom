import { describe, expect, test } from "vitest";
import {
  OBJECT_ABBREVIATIONS,
  OBJECT_LABELS,
} from "../../src/features/demo/room-canvas";
import {
  projectContactShadow,
} from "../../src/features/photo/photo-projection";
import { PHOTO_VIEW_SYMMETRY } from "../../src/features/photo/photo-views";
import {
  CATEGORY_DIMENSIONS,
  buildScene,
} from "../../src/features/room/room-engine";
import {
  ProductCategorySchema,
  SceneObjectTypeSchema,
  type SceneObject,
  type SceneObjectType,
} from "../../src/features/scene/scene-schema";
import {
  SEARCH_PRODUCTS_JSON_SCHEMA,
  searchProductsInputSchema,
} from "../../src/webmcp/tool-contracts";

type PlaceableType = Exclude<SceneObjectType, "unknown">;

const ROOM = { width: 6, height: 2.5, depth: 4.8 };

/** The id prefix each category owns (design §3); ids must stay disjoint. */
const EXPECTED_ID_PREFIXES: Readonly<Record<PlaceableType, string>> = {
  sofa: "sofa",
  coffee_table: "table",
  rug: "rug",
  floor_lamp: "lamp",
  chair: "chair",
  plant: "plant",
  side_table: "side",
  bookshelf: "shelf",
};

const PLACEABLE_TYPES = SceneObjectTypeSchema.options.filter(
  (type): type is PlaceableType => type !== "unknown",
);

/** One seeded object per placeable type, built through the public room engine. */
function objectsOfEveryType(): readonly SceneObject[] {
  return buildScene(
    {
      roomType: "living_room",
      estimatedAspectRatio: ROOM.width / ROOM.depth,
      openings: [],
      objects: PLACEABLE_TYPES.map((type) => ({
        type,
        anchor: "center",
        confidence: 0.9,
      })),
    },
    ROOM.width,
  ).objects;
}

describe("scene object type enums", () => {
  test("lists the two new categories after plant and before unknown", () => {
    expect(SceneObjectTypeSchema.options).toEqual([
      "sofa",
      "coffee_table",
      "rug",
      "floor_lamp",
      "chair",
      "plant",
      "side_table",
      "bookshelf",
      "unknown",
    ]);
  });

  test("product categories are the object types minus unknown", () => {
    expect(ProductCategorySchema.options).toEqual(
      SceneObjectTypeSchema.options.filter((type) => type !== "unknown"),
    );
  });
});

describe("per-category tables", () => {
  test("every placeable type has dimensions", () => {
    for (const type of PLACEABLE_TYPES) {
      const dimensions = CATEGORY_DIMENSIONS[type];
      expect(dimensions, type).toBeDefined();
      expect(dimensions.width, type).toBeGreaterThan(0);
      expect(dimensions.height, type).toBeGreaterThan(0);
      expect(dimensions.depth, type).toBeGreaterThan(0);
    }
    expect(CATEGORY_DIMENSIONS.side_table).toEqual({
      width: 0.45,
      height: 0.55,
      depth: 0.45,
    });
    expect(CATEGORY_DIMENSIONS.bookshelf).toEqual({
      width: 0.9,
      height: 1.8,
      depth: 0.35,
    });
  });

  test("every placeable type has its own id prefix", () => {
    const objects = objectsOfEveryType();
    expect(objects).toHaveLength(PLACEABLE_TYPES.length);
    for (const object of objects) {
      expect(object.id, object.type).toBe(
        `${EXPECTED_ID_PREFIXES[object.type as PlaceableType]}_01`,
      );
    }
    expect(new Set(Object.values(EXPECTED_ID_PREFIXES)).size).toBe(
      PLACEABLE_TYPES.length,
    );
  });

  test("every placeable type has a photo view symmetry", () => {
    for (const type of PLACEABLE_TYPES) {
      expect(["none", "front-back", "radial"], type).toContain(
        PHOTO_VIEW_SYMMETRY[type],
      );
    }
    expect(PHOTO_VIEW_SYMMETRY.side_table).toBe("radial");
    expect(PHOTO_VIEW_SYMMETRY.bookshelf).toBe("front-back");
  });

  test("every placeable type has a contact shadow profile", () => {
    for (const object of objectsOfEveryType()) {
      const shadow = projectContactShadow(object, ROOM);
      expect(shadow.opacity, object.type).toBeGreaterThan(0);
      expect(shadow.width, object.type).toBeGreaterThan(0);
      expect(shadow.height, object.type).toBeGreaterThan(0);
    }
  });

  test("every placeable type has a rail label and initials", () => {
    for (const type of PLACEABLE_TYPES) {
      expect(OBJECT_LABELS[type], type).toMatch(/\S/);
      expect(OBJECT_ABBREVIATIONS[type], type).toMatch(/^[A-Z]{2}$/);
    }
    expect(OBJECT_ABBREVIATIONS.side_table).toBe("SI");
    expect(OBJECT_ABBREVIATIONS.bookshelf).toBe("BS");
    const initials = PLACEABLE_TYPES.map((type) => OBJECT_ABBREVIATIONS[type]);
    expect(new Set(initials).size).toBe(initials.length);
  });
});

describe("search_products category enum", () => {
  test("the JSON schema enum equals the Zod enum", () => {
    expect([...SEARCH_PRODUCTS_JSON_SCHEMA.properties.category.enum]).toEqual([
      ...ProductCategorySchema.options,
    ]);
  });

  test("accepts every catalog category and nothing else", () => {
    for (const category of ProductCategorySchema.options) {
      expect(
        searchProductsInputSchema.safeParse({ category }).success,
        category,
      ).toBe(true);
    }
    expect(
      searchProductsInputSchema.safeParse({ category: "unknown" }).success,
    ).toBe(false);
  });
});
