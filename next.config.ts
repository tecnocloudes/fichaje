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
    // Router Cache cliente: por defecto Next.js reusa páginas cacheadas
    // 30s aunque cambies de subdominio (la cache key es solo el path,
    // no el host). En multi-tenant esto causa que el /login del subdominio
    // app (form global) se reuse en <slug>.<root>/login (form del tenant)
    // y el navegador renderiza el HTML de la primera carga aunque el
    // server envíe el correcto. staleTimes 0 invalida el cache cliente
    // en cada navegación.
    staleTimes: {
      dynamic: 0,
      static: 0,
    },
  },
};

export default nextConfig;
