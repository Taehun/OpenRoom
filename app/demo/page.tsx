import type { Metadata } from "next";
import { DemoWorkspace } from "../../src/features/demo/demo-workspace";

export const metadata: Metadata = {
  title: "OpenRoom",
  description:
    "AI room planner and furniture shopping — furnish a real room photo with catalog products, by hand or through the AI app you already use.",
};

export default function DemoPage() {
  // `/` hosts the guide, and the Scene store sits in the root layout, so the
  // round trip is a soft navigation that keeps the room.
  return <DemoWorkspace guideHref="/?view=guide" />;
}
