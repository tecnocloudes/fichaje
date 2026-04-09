import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol, EstadoTurno } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const tiendaId = searchParams.get("tiendaId");
    const userId = searchParams.get("userId");
    const fechaInicio = searchParams.get("fechaInicio");
    const fechaFin = searchParams.get("fechaFin");
    const estado = searchParams.get("estado") as EstadoTurno | null;

    const userRol = (session.user as any).rol as Rol;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (userRol === Rol.SUPERADMIN) {
      if (tiendaId) where.tiendaId = tiendaId;
      if (userId) where.userId = userId;
    } else if (userRol === Rol.MANAGER) {
      where.tiendaId = userTiendaId;
      if (userId) where.userId = userId;
    } else {
      // EMPLEADO
      where.userId = session.user.id;
    }

    if (estado && Object.values(EstadoTurno).includes(estado)) {
      where.estado = estado;
    }

    if (fechaInicio || fechaFin) {
      where.fecha = {};
      if (fechaInicio) where.fecha.gte = new Date(fechaInicio);
      if (fechaFin) {
        const fin = new Date(fechaFin);
        fin.setHours(23, 59, 59, 999);
        where.fecha.lte = fin;
      }
    }

    const turnos = await prisma.turno.findMany({
      where,
      include: {
        user: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        tienda: {
          select: { id: true, nombre: true, color: true },
        },
      },
      orderBy: { fecha: "asc" },
    });

    return Response.json(turnos);
  } catch (error) {
    console.error("GET /api/turnos error:", error);
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
    if (userRol !== Rol.SUPERADMIN && userRol !== Rol.MANAGER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json();
    const {
      userId,
      tiendaId,
      fecha,
      horaInicio,
      horaFin,
      nota,
      estado = EstadoTurno.BORRADOR,
    } = body as {
      userId: string;
      tiendaId: string;
      fecha: string;
      horaInicio: string;
      horaFin: string;
      nota?: string;
      estado?: EstadoTurno;
    };

    if (!userId || !tiendaId || !fecha || !horaInicio || !horaFin) {
      return Response.json(
        { error: "Faltan campos obligatorios: userId, tiendaId, fecha, horaInicio, horaFin" },
        { status: 400 }
      );
    }

    // MANAGER can only create turnos for their tienda
    if (userRol === Rol.MANAGER) {
      const userTiendaId = (session.user as any).tiendaId as string | null;
      if (tiendaId !== userTiendaId) {
        return Response.json({ error: "No autorizado para esta tienda" }, { status: 403 });
      }
    }

    const turno = await prisma.turno.create({
      data: {
        userId,
        tiendaId,
        fecha: new Date(fecha),
        horaInicio,
        horaFin,
        nota,
        estado,
      },
      include: {
        user: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        tienda: {
          select: { id: true, nombre: true, color: true },
        },
      },
    });

    return Response.json(turno, { status: 201 });
  } catch (error) {
    console.error("POST /api/turnos error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
