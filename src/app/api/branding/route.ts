import { prisma } from "@/lib/prisma";

// Public endpoint – no auth required (used in layout for CSS vars + metadata)
export async function GET() {
  try {
    const config = await prisma.configuracionEmpresa.findFirst({
      select: {
        appNombre: true,
        nombre: true,
        colorPrimario: true,
        colorSidebar: true,
        logo: true,
        favicon: true,
      },
    });

    return Response.json(
      {
        appNombre: config?.appNombre ?? "TelecomFichaje",
        nombre: config?.nombre ?? "Mi Empresa",
        colorPrimario: config?.colorPrimario ?? "#6366f1",
        colorSidebar: config?.colorSidebar ?? "#1e1b4b",
        logo: config?.logo ?? null,
        hasFavicon: !!config?.favicon,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch {
    return Response.json({
      appNombre: "TelecomFichaje",
      nombre: "Mi Empresa",
      colorPrimario: "#6366f1",
      colorSidebar: "#1e1b4b",
      logo: null,
      hasFavicon: false,
    });
  }
}
