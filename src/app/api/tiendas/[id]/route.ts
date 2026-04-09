import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

export async function PUT(
  request: NextRequest,
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

    const tienda = await prisma.tienda.findUnique({ where: { id } });
    if (!tienda) {
      return Response.json({ error: "Tienda no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const {
      nombre,
      direccion,
      ciudad,
      codigoPostal,
      telefono,
      email,
      latitud,
      longitud,
      radio,
      color,
      activa,
    } = body as {
      nombre?: string;
      direccion?: string;
      ciudad?: string;
      codigoPostal?: string;
      telefono?: string;
      email?: string;
      latitud?: number;
      longitud?: number;
      radio?: number;
      color?: string;
      activa?: boolean;
    };

    const updated = await prisma.tienda.update({
      where: { id },
      data: {
        ...(nombre !== undefined && { nombre }),
        ...(direccion !== undefined && { direccion }),
        ...(ciudad !== undefined && { ciudad }),
        ...(codigoPostal !== undefined && { codigoPostal }),
        ...(telefono !== undefined && { telefono }),
        ...(email !== undefined && { email }),
        ...(latitud !== undefined && { latitud }),
        ...(longitud !== undefined && { longitud }),
        ...(radio !== undefined && { radio }),
        ...(color !== undefined && { color }),
        ...(activa !== undefined && { activa }),
      },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("PUT /api/tiendas/[id] error:", error);
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

    const tienda = await prisma.tienda.findUnique({ where: { id } });
    if (!tienda) {
      return Response.json({ error: "Tienda no encontrada" }, { status: 404 });
    }

    // Soft delete
    const updated = await prisma.tienda.update({
      where: { id },
      data: { activa: false },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("DELETE /api/tiendas/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
