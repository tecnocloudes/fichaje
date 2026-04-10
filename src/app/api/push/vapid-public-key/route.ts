import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const config = await prisma.configuracionEmpresa.findFirst({
      select: { pushActivo: true, pushVapidPublicKey: true },
    });

    return Response.json({
      pushActivo: config?.pushActivo ?? false,
      publicKey: config?.pushVapidPublicKey ?? null,
    });
  } catch (error) {
    console.error("GET /api/push/vapid-public-key error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
