import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma/client";
import webpush from "web-push";

export async function POST() {
  try {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user || user.rol !== Rol.SUPERADMIN) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const vapidKeys = webpush.generateVAPIDKeys();

    await prisma.configuracionEmpresa.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        pushVapidPublicKey: vapidKeys.publicKey,
        pushVapidPrivateKey: vapidKeys.privateKey,
      },
      update: {
        pushVapidPublicKey: vapidKeys.publicKey,
        pushVapidPrivateKey: vapidKeys.privateKey,
      },
    });

    return Response.json({ publicKey: vapidKeys.publicKey });
  } catch (error) {
    console.error("POST /api/push/generar-vapid error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
