import type { MetadataRoute } from "next";

/**
 * The Pages build exports the site statically (`NEXT_OUTPUT=export`), and a
 * metadata route has to opt in to that or the export fails.
 */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "OpenRoom",
    short_name: "OpenRoom",
    description: "AI Room Planner & Furniture Shopping",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#FBF9F4",
    theme_color: "#4B6543",
    icons: [
      {
        src: "/icons/openroom-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/openroom-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/openroom-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
