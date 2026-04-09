import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["bcryptjs"],
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
