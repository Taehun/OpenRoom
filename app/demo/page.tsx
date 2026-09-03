import type { Metadata } from "next";
import { DemoWorkspace } from "../../src/features/demo/demo-workspace";

export const metadata: Metadata = {
  title: "OpenRoom",
  description:
    "AI Room Planner & Furniture Shopping — furnish a real room photo with catalog products, by hand or through the AI app you already use.",
};

export default function DemoPage() {
  return <DemoWorkspace />;
}
