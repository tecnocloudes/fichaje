import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const notificacion = await prisma.notificacion.findUnique({ where: { id } });
    if (!notificacion) {
      return Response.json({ error: "Notificación no encontrada" }, { status: 404 });
    }

    // Users can only mark their own notifications as read
    if (notificacion.userId !== session.user.id) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const updated = await prisma.notificacion.update({
      where: { id },
      data: { leida: true },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("PATCH /api/notificaciones/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
