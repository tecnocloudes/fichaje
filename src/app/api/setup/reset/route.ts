import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.SUPERADMIN) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json();
    const { confirmacion } = body as { confirmacion: string };

    if (confirmacion !== "BORRAR TODO") {
      return Response.json({ error: "Confirmación incorrecta" }, { status: 400 });
    }

    // Delete everything in dependency order
    await prisma.notificacion.deleteMany();
    await prisma.fichaje.deleteMany();
    await prisma.turno.deleteMany();
    await prisma.ausencia.deleteMany();
    await prisma.tipoAusencia.deleteMany();
    await prisma.tarea.deleteMany();
    await prisma.comunicado.deleteMany();
    await prisma.articulo.deleteMany();
    await prisma.documento.deleteMany();
    await prisma.procesoOnboarding.deleteMany();
    await prisma.festivo.deleteMany();
    await prisma.configuracionEmpresa.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tienda.deleteMany();

    return Response.json({ success: true });
  } catch (error) {
    console.error("POST /api/setup/reset error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
