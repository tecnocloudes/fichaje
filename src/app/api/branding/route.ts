import { prismaApp as prisma } from "@/lib/prisma";

// Public endpoint – no auth required (used in layout for CSS vars + metadata)
import { withTenant } from "@/lib/tenant/with-tenant";
export const GET = withTenant(async () => {
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
        appNombre: config?.appNombre ?? "empleaIA",
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
      appNombre: "empleaIA",
      nombre: "Mi Empresa",
      colorPrimario: "#6366f1",
      colorSidebar: "#1e1b4b",
      logo: null,
      hasFavicon: false,
    });
  }
});
