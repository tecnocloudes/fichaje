import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const GET = withTenant(withFeature("ausencias_aprobacion", async () => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const tiposAusencia = await prisma.tipoAusencia.findMany({
      where: { activo: true },
      orderBy: { nombre: "asc" },
    });

    return Response.json(tiposAusencia);
  } catch (error) {
    console.error("GET /api/ausencias/tipos error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}));

export const POST = withTenant(withFeature("ausencias_aprobacion", async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json();
    const {
      nombre,
      color = "#6366f1",
      icono = "calendar",
      pagada = true,
      requiereAprobacion = true,
      diasMaximos,
    } = body as {
      nombre: string;
      color?: string;
      icono?: string;
      pagada?: boolean;
      requiereAprobacion?: boolean;
      diasMaximos?: number;
    };

    if (!nombre) {
      return Response.json({ error: "El nombre es obligatorio" }, { status: 400 });
    }

    const tipoAusencia = await prisma.tipoAusencia.create({
      data: {
        nombre,
        color,
        icono,
        pagada,
        requiereAprobacion,
        diasMaximos,
      },
    });

    return Response.json(tipoAusencia, { status: 201 });
  } catch (error) {
    console.error("POST /api/ausencias/tipos error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}));
