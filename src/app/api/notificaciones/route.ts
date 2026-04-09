import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const leidaParam = searchParams.get("leida");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { userId: session.user.id };

    if (leidaParam !== null) {
      where.leida = leidaParam === "true";
    }

    const notificaciones = await prisma.notificacion.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return Response.json(notificaciones);
  } catch (error) {
    console.error("GET /api/notificaciones error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function PATCH() {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    // Mark all notifications as read for the authenticated user
    await prisma.notificacion.updateMany({
      where: {
        userId: session.user.id,
        leida: false,
      },
      data: { leida: true },
    });

    return Response.json({ message: "Todas las notificaciones marcadas como leídas" });
  } catch (error) {
    console.error("PATCH /api/notificaciones error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
