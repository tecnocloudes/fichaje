import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { runMigrations } from "@/lib/migrate";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { validateImagePayload } from "@/lib/branding/validate";

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
      appNombre: config?.appNombre ?? "empleaIA",
      colorPrimario: config?.colorPrimario ?? "#6366f1",
      colorSidebar: config?.colorSidebar ?? "#1e1b4b",
    });
  } catch {
    return Response.json({ logo: null, appNombre: "empleaIA", colorPrimario: "#6366f1", colorSidebar: "#1e1b4b" });
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

    // Validación formato + cap por imagen (plan Fase 6 §2.2).
    if ("logo" in body) {
      const v = validateImagePayload(body.logo, "logo");
      if (!v.ok) return Response.json(v.body, { status: v.status });
    }
    if ("favicon" in body) {
      const v = validateImagePayload(body.favicon, "favicon");
      if (!v.ok) return Response.json(v.body, { status: v.status });
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
