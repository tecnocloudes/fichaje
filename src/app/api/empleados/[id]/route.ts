import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";

const userSelect = {
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
} as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const userRol = (session.user as any).rol as Rol;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    // Can access own profile, or SUPERADMIN/MANAGER can access others
    if (
      id !== session.user.id &&
      userRol !== Rol.SUPERADMIN &&
      userRol !== Rol.MANAGER
    ) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const empleado = await prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });

    if (!empleado) {
      return Response.json({ error: "Empleado no encontrado" }, { status: 404 });
    }

    // MANAGER can only access their tienda's employees (and own profile)
    if (
      userRol === Rol.MANAGER &&
      id !== session.user.id &&
      empleado.tiendaId !== userTiendaId
    ) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    return Response.json(empleado);
  } catch (error) {
    console.error("GET /api/empleados/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const userRol = (session.user as any).rol as Rol;

    // Only SUPERADMIN or the user themselves can update
    if (id !== session.user.id && userRol !== Rol.SUPERADMIN) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const empleado = await prisma.user.findUnique({ where: { id } });
    if (!empleado) {
      return Response.json({ error: "Empleado no encontrado" }, { status: 404 });
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
      rol,
      tiendaId,
    } = body as {
      email?: string;
      password?: string;
      nombre?: string;
      apellidos?: string;
      dni?: string;
      telefono?: string;
      foto?: string;
      rol?: Rol;
      tiendaId?: string;
    };

    // Non-admins cannot change their own role or tienda
    if (id === session.user.id && userRol !== Rol.SUPERADMIN) {
      if (rol !== undefined || tiendaId !== undefined) {
        return Response.json(
          { error: "No puedes cambiar tu propio rol o tienda" },
          { status: 403 }
        );
      }
    }

    // Check email uniqueness if changing email
    if (email && email !== empleado.email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return Response.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};
    if (email !== undefined) updateData.email = email;
    if (nombre !== undefined) updateData.nombre = nombre;
    if (apellidos !== undefined) updateData.apellidos = apellidos;
    if (dni !== undefined) updateData.dni = dni;
    if (telefono !== undefined) updateData.telefono = telefono;
    if (foto !== undefined) updateData.foto = foto;
    if (rol !== undefined && userRol === Rol.SUPERADMIN) updateData.rol = rol;
    if (tiendaId !== undefined && userRol === Rol.SUPERADMIN) updateData.tiendaId = tiendaId;

    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: userSelect,
    });

    return Response.json(updated);
  } catch (error) {
    console.error("PUT /api/empleados/[id] error:", error);
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

    if (id === session.user.id) {
      return Response.json({ error: "No puedes eliminar tu propia cuenta" }, { status: 400 });
    }

    const empleado = await prisma.user.findUnique({ where: { id } });
    if (!empleado) {
      return Response.json({ error: "Empleado no encontrado" }, { status: 404 });
    }

    // Hard delete — remove related records first to satisfy FK constraints
    await prisma.pushSubscripcion.deleteMany({ where: { userId: id } });
    await prisma.preferenciasNotificacion.deleteMany({ where: { userId: id } });
    await prisma.notificacion.deleteMany({ where: { userId: id } });
    await prisma.fichaje.deleteMany({ where: { userId: id } });
    await prisma.turno.deleteMany({ where: { userId: id } });
    await prisma.ausencia.deleteMany({ where: { userId: id } });
    await prisma.ausencia.updateMany({ where: { aprobadoPorId: id }, data: { aprobadoPorId: null } });
    await prisma.tarea.deleteMany({ where: { creadoPorId: id } });
    await prisma.tarea.updateMany({ where: { asignadoAId: id }, data: { asignadoAId: null } });
    await prisma.comunicado.deleteMany({ where: { autorId: id } });
    await prisma.articulo.deleteMany({ where: { autorId: id } });
    await prisma.documento.deleteMany({ where: { userId: id } });
    await prisma.documento.deleteMany({ where: { subidoPorId: id } });
    await prisma.procesoOnboarding.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });

    return Response.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/empleados/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
