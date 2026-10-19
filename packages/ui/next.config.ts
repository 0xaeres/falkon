import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  transpilePackages: ["@sbc/contracts"],
};

export default nextConfig;
