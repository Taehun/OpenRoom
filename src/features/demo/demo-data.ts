import type { DemoCartItem, DemoProduct } from "./demo-types";

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  {
    id: "oak-frame-table",
    variantId: "demo-variant-oak-frame-table",
    title: "Oak Frame Table",
    category: "coffee_table",
    price: { amountMinor: 16900, currency: "USD" },
    dimensionsCm: { width: 105, height: 40, depth: 55 },
    styleTags: ["japandi", "light-oak"],
    color: "light-oak",
    material: "oak",
    description: "A low oak table with a softened architectural frame.",
  },
  {
    id: "travertine-plinth-table",
    variantId: "demo-variant-travertine-plinth-table",
    title: "Travertine Plinth Table",
    category: "coffee_table",
    price: { amountMinor: 24900, currency: "USD" },
    dimensionsCm: { width: 110, height: 38, depth: 60 },
    styleTags: ["warm-minimal", "stone"],
    color: "ivory",
    material: "travertine",
    description: "A quiet stone-led alternative for the centre of the room.",
  },
  {
    id: "walnut-nesting-table",
    variantId: "demo-variant-walnut-nesting-table",
    title: "Walnut Nesting Table",
    category: "coffee_table",
    price: { amountMinor: 21900, currency: "USD" },
    dimensionsCm: { width: 95, height: 42, depth: 55 },
    styleTags: ["mid-century", "warm-walnut"],
    color: "walnut",
    material: "walnut",
    description: "Two compact surfaces in a rich, warm timber finish.",
  },
];

export const CART_ITEMS: readonly DemoCartItem[] = [
  { id: "coffee-table", name: "Coffee Table", priceMinor: 18900 },
  { id: "floor-lamp", name: "Floor Lamp", priceMinor: 12900 },
  { id: "rug", name: "Rug", priceMinor: 24900 },
  { id: "plant", name: "Plant", priceMinor: 5900 },
];
