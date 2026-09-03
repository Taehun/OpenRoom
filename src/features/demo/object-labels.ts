import type { SceneObjectType } from "../scene/scene-schema";

/**
 * The one name every surface uses for a piece of furniture — the rail, the
 * canvas label, the inspector, and the cart — so the same object never reads
 * as "Sofa" in one place and "Linen sofa" in another.
 */
export const OBJECT_LABELS: Readonly<Record<SceneObjectType, string>> = {
  sofa: "Sofa",
  coffee_table: "Coffee table",
  rug: "Rug",
  floor_lamp: "Floor lamp",
  chair: "Chair",
  plant: "Plant",
  side_table: "Side table",
  bookshelf: "Bookshelf",
  unknown: "Object",
};

/** The object rail shows initials, one pair per Scene object type. */
export const OBJECT_ABBREVIATIONS: Readonly<Record<SceneObjectType, string>> = {
  sofa: "SO",
  coffee_table: "CT",
  rug: "RG",
  floor_lamp: "FL",
  chair: "CH",
  plant: "PL",
  side_table: "SI",
  bookshelf: "BS",
  unknown: "OB",
};

/** The product title when the piece is a catalog pick, else its type label. */
export function objectDisplayName(object: {
  type: SceneObjectType;
  product?: { title: string } | null | undefined;
}): string {
  return object.product?.title ?? OBJECT_LABELS[object.type];
}

/**
 * Catalog data stores materials and colours as slugs (`rice-paper-and-ash`);
 * people read "Rice paper and ash".
 */
export function humanizeSlug(slug: string): string {
  const words = slug.split(/[-_]+/).filter(Boolean);
  if (words.length === 0) return slug;
  return words
    .map((word, index) => (index === 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}
