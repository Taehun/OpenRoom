import type { DemoCartItem, DemoProduct } from "./demo-types";

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  {
    id: "oak-frame-table",
    name: "Oak Frame Table",
    priceMinor: 16900,
    description: "A low oak table with a softened architectural frame.",
  },
  {
    id: "travertine-plinth-table",
    name: "Travertine Plinth Table",
    priceMinor: 24900,
    description: "A quiet stone-led alternative for the centre of the room.",
  },
  {
    id: "walnut-nesting-table",
    name: "Walnut Nesting Table",
    priceMinor: 21900,
    description: "Two compact surfaces in a rich, warm timber finish.",
  },
];

export const CART_ITEMS: readonly DemoCartItem[] = [
  { id: "coffee-table", name: "Coffee Table", priceMinor: 18900 },
  { id: "floor-lamp", name: "Floor Lamp", priceMinor: 12900 },
  { id: "rug", name: "Rug", priceMinor: 24900 },
  { id: "plant", name: "Plant", priceMinor: 5900 },
];
