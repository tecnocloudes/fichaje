import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.SUPERADMIN && userRol !== Rol.MANAGER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const tiendaId = searchParams.get("tiendaId");
    const rol = searchParams.get("rol") as Rol | null;
    const activo = searchParams.get("activo");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (userRol === Rol.SUPERADMIN) {
      if (tiendaId) where.tiendaId = tiendaId;
    } else {
      // MANAGER sees only their tienda
      const userTiendaId = (session.user as any).tiendaId as string | null;
      where.tiendaId = userTiendaId;
    }

    if (rol && Object.values(Rol).includes(rol)) {
      where.rol = rol;
    }

    if (activo !== null) {
      where.activo = activo === "true";
    }

    const empleados = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        nombre: true,
        apellidos: true,
        dni: true,
        telefono: true,
        foto: true,
        rol: true,
        tiendaId: true,
        tienda: { select: { id: true, nombre: true } },
        activo: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
    });

    return Response.json(empleados);
  } catch (error) {
    console.error("GET /api/empleados error:", error);
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
      email,
      password,
      nombre,
      apellidos,
      dni,
      telefono,
      foto,
      rol = Rol.EMPLEADO,
      tiendaId,
    } = body as {
      email: string;
      password: string;
      nombre: string;
      apellidos: string;
      dni?: string;
      telefono?: string;
      foto?: string;
      rol?: Rol;
      tiendaId?: string;
    };

    if (!email || !password || !nombre || !apellidos) {
      return Response.json(
        { error: "Faltan campos obligatorios: email, password, nombre, apellidos" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return Response.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const empleado = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        nombre,
        apellidos,
        dni,
        telefono,
        foto,
        rol,
        tiendaId,
      },
      select: {
        id: true,
        email: true,
        nombre: true,
        apellidos: true,
        dni: true,
        telefono: true,
        foto: true,
        rol: true,
        tiendaId: true,
        tienda: { select: { id: true, nombre: true } },
        activo: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return Response.json(empleado, { status: 201 });
  } catch (error) {
    console.error("POST /api/empleados error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
