import type { Metadata } from "next";
import { DemoWorkspace } from "../../src/features/demo/demo-workspace";

export const metadata: Metadata = {
  title: "Spatial Atelier | OpenInterior",
  description:
    "A deterministic spatial commerce workspace where the room becomes the storefront.",
};

export default function DemoPage() {
  return <DemoWorkspace />;
}
