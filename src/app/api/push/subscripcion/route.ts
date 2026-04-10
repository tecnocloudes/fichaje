import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = (session.user as { id: string }).id;

    const { endpoint, keys } = await request.json();
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return Response.json({ error: "Datos de suscripción inválidos" }, { status: 400 });
    }

    const sub = await prisma.pushSubscripcion.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { userId, p256dh: keys.p256dh, auth: keys.auth },
    });

    return Response.json({ id: sub.id });
  } catch (error) {
    console.error("POST /api/push/subscripcion error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = (session.user as { id: string }).id;

    const { endpoint } = await request.json();
    if (!endpoint) {
      return Response.json({ error: "endpoint requerido" }, { status: 400 });
    }

    await prisma.pushSubscripcion
      .deleteMany({ where: { endpoint, userId } })
      .catch(() => {});

    return Response.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/push/subscripcion error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
