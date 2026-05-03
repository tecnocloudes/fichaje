import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Output standalone para Docker — Next copia solo lo imprescindible
  // a `.next/standalone/` (incluye un server.js y un node_modules
  // mínimo con las deps usadas en runtime). El runner del Dockerfile
  // copia esa carpeta + `.next/static` + `public`.
  output: "standalone",
  serverExternalPackages: ["bcryptjs", "nodemailer", "web-push"],
  images: {
    remotePatterns: [],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
