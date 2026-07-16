import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/controle-do-gas-pwa",
  assetPrefix: "/controle-do-gas-pwa/",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
