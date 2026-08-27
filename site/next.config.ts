import type { NextConfig } from "next";

// Empty for local/root hosting; set to "/<repo>" when published to a GitHub
// Pages project site, which serves the build from a sub-path. actions/
// configure-pages emits "/" for user sites, which Next rejects as a basePath.
const raw = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim();
const basePath = raw === "/" ? "" : raw.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
