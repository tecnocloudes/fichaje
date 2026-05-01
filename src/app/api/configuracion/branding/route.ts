import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { runMigrations } from "@/lib/migrate";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB per image

// GET sin withFeature: la app necesita SIEMPRE poder leer el branding
// para renderizar el header/sidebar. Si el plan no tiene
// branding_personalizado, los valores devueltos son los defaults.
// Solo PUT (modificación) requiere la feature.

export const GET = withTenant(async () => {
  try {
    const config = await prisma.configuracionEmpresa.findFirst({
      select: { logo: true, appNombre: true, colorPrimario: true, colorSidebar: true },
    });
    return Response.json({
      logo: config?.logo ?? null,
      appNombre: config?.appNombre ?? "HR Suite",
      colorPrimario: config?.colorPrimario ?? "#6366f1",
      colorSidebar: config?.colorSidebar ?? "#1e1b4b",
    });
  } catch {
    return Response.json({ logo: null, appNombre: "HR Suite", colorPrimario: "#6366f1", colorSidebar: "#1e1b4b" });
  }
});

export const PUT = withTenant(withFeature("branding_personalizado", async (request: NextRequest) => {
  try {
    await runMigrations();

    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user || user.rol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();

    // Validate image sizes (base64 string length ≈ 4/3 * bytes)
    if (body.logo && body.logo.length > MAX_IMAGE_BYTES * 1.4) {
      return Response.json({ error: "El logo supera el tamaño máximo de 3 MB" }, { status: 413 });
    }
    if (body.favicon && body.favicon.length > MAX_IMAGE_BYTES * 1.4) {
      return Response.json({ error: "El favicon supera el tamaño máximo de 3 MB" }, { status: 413 });
    }

    const data: Record<string, unknown> = {};
    const allowed = ["appNombre", "nombre", "colorPrimario", "colorSidebar", "logo", "favicon"];
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }

    const config = await prisma.configuracionEmpresa.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
      select: {
        appNombre: true,
        nombre: true,
        colorPrimario: true,
        colorSidebar: true,
        logo: true,
        favicon: true,
      },
    });

    return Response.json({ ...config, favicon: !!config.favicon });
  } catch (error) {
    console.error("PUT /api/configuracion/branding error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}));
