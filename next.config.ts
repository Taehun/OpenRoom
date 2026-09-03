import type { NextConfig } from "next";

// `NEXT_OUTPUT=export` produces a fully static site in `out/` for Cloudflare
// Pages; the default build stays the Worker bundle. Both routes are already
// prerendered, and the remote image loader is unnecessary for local cutouts.
const exporting = process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = {
  ...(exporting ? { output: "export", images: { unoptimized: true } } : {}),
};

export default nextConfig;
