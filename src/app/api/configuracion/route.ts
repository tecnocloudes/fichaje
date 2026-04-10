import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const config = await prisma.configuracionEmpresa.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
    });

    const user = session.user as { rol?: string };
    if (user.rol !== Rol.SUPERADMIN) {
      return Response.json({
        nombre: config.nombre,
        horasJornadaDiaria: config.horasJornadaDiaria,
        horasSemanales: config.horasSemanales,
        toleranciaFichaje: config.toleranciaFichaje,
        geofencingActivo: config.geofencingActivo,
        fichajeMovilActivo: config.fichajeMovilActivo,
        fichajeTabletActivo: config.fichajeTabletActivo,
      });
    }

    return Response.json({ ...config, pushVapidPrivateKey: undefined });
  } catch (error) {
    console.error("GET /api/configuracion error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user || user.rol !== Rol.SUPERADMIN) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();

    // Allowlist — never touch VAPID private key, logo/favicon (handled by /branding), or id
    const data: Record<string, unknown> = {};
    const allowed = [
      "nombre", "appNombre",
      "horasJornadaDiaria", "horasSemanales", "toleranciaFichaje",
      "geofencingActivo", "fichajeMovilActivo", "fichajeTabletActivo",
      "notifAusencias", "notifTurnos", "notifTareas", "notifFichajes", "notifComunicados",
      "emailActivo", "emailHost", "emailPort", "emailSecure", "emailUser", "emailPassword", "emailFrom",
      "pushActivo", "pushVapidPublicKey",
      "colorPrimario", "colorSidebar",
    ];
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }

    const config = await prisma.configuracionEmpresa.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });

    return Response.json({ ...config, pushVapidPrivateKey: undefined });
  } catch (error) {
    console.error("PUT /api/configuracion error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
