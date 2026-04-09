import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const tiendas = await prisma.tienda.findMany({
      where: { activa: true },
      orderBy: { nombre: "asc" },
    });

    return Response.json(tiendas);
  } catch (error) {
    console.error("GET /api/tiendas error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

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
    const {
      nombre,
      direccion,
      ciudad,
      codigoPostal,
      telefono,
      email,
      latitud,
      longitud,
      radio = 200,
      color = "#6366f1",
    } = body as {
      nombre: string;
      direccion: string;
      ciudad: string;
      codigoPostal?: string;
      telefono?: string;
      email?: string;
      latitud?: number;
      longitud?: number;
      radio?: number;
      color?: string;
    };

    if (!nombre || !direccion || !ciudad) {
      return Response.json(
        { error: "Faltan campos obligatorios: nombre, direccion, ciudad" },
        { status: 400 }
      );
    }

    const tienda = await prisma.tienda.create({
      data: {
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
      },
    });

    return Response.json(tienda, { status: 201 });
  } catch (error) {
    console.error("POST /api/tiendas error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
