import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
export const GET = withTenant(async () => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = (session.user as { id: string }).id;

    const prefs = await prisma.preferenciasNotificacion.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    return Response.json(prefs);
  } catch (error) {
    console.error("GET /api/notificaciones/preferencias error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const PUT = withTenant(async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = (session.user as { id: string }).id;

    const body = await request.json();
    delete body.id;
    delete body.userId;
    delete body.updatedAt;

    const prefs = await prisma.preferenciasNotificacion.upsert({
      where: { userId },
      create: { userId, ...body },
      update: body,
    });

    return Response.json(prefs);
  } catch (error) {
    console.error("PUT /api/notificaciones/preferencias error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
