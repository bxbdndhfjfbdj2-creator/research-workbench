import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@research-workbench/ui",
    "@research-workbench/application",
    "@research-workbench/db",
    "@research-workbench/domain",
  ],
};

export default nextConfig;
