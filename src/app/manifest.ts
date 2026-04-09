import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TelecomFichaje",
    short_name: "Fichaje",
    description: "Sistema de fichaje para tiendas de telecomunicaciones",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#6366f1",
    orientation: "portrait-primary",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
