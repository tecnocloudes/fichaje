import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol, TipoFichaje } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.SUPERADMIN && userRol !== Rol.MANAGER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const fichaje = await prisma.fichaje.findUnique({ where: { id } });
    if (!fichaje) {
      return Response.json({ error: "Fichaje no encontrado" }, { status: 404 });
    }

    // MANAGER can only edit fichajes from their tienda
    if (userRol === Rol.MANAGER) {
      const userTiendaId = (session.user as any).tiendaId as string | null;
      if (fichaje.tiendaId !== userTiendaId) {
        return Response.json({ error: "No autorizado" }, { status: 403 });
      }
    }

    const body = await request.json();
    const { tipo, timestamp, nota } = body as {
      tipo?: TipoFichaje;
      timestamp?: string;
      nota?: string;
    };

    const updated = await prisma.fichaje.update({
      where: { id },
      data: {
        ...(tipo && { tipo }),
        ...(timestamp && { timestamp: new Date(timestamp) }),
        ...(nota !== undefined && { nota }),
        editadoPor: session.user.id,
        editadoEn: new Date(),
      },
      include: {
        user: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        tienda: {
          select: { id: true, nombre: true },
        },
      },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("PATCH /api/fichajes/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.SUPERADMIN) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const fichaje = await prisma.fichaje.findUnique({ where: { id } });
    if (!fichaje) {
      return Response.json({ error: "Fichaje no encontrado" }, { status: 404 });
    }

    await prisma.fichaje.delete({ where: { id } });

    return Response.json({ message: "Fichaje eliminado correctamente" });
  } catch (error) {
    console.error("DELETE /api/fichajes/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
