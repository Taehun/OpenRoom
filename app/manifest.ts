import type { MetadataRoute } from "next";

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
