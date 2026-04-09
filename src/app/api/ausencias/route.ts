import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol, EstadoAusencia } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

function calcularDias(fechaInicio: Date, fechaFin: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = fechaFin.getTime() - fechaInicio.getTime();
  return Math.max(1, Math.round(diff / msPerDay) + 1);
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const estado = searchParams.get("estado") as EstadoAusencia | null;
    const userId = searchParams.get("userId");
    const tiendaId = searchParams.get("tiendaId");

    const userRol = (session.user as any).rol as Rol;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (userRol === Rol.SUPERADMIN) {
      if (userId) where.userId = userId;
      if (tiendaId) {
        where.user = { tiendaId };
      }
    } else if (userRol === Rol.MANAGER) {
      where.user = { tiendaId: userTiendaId };
      if (userId) where.userId = userId;
    } else {
      // EMPLEADO
      where.userId = session.user.id;
    }

    if (estado && Object.values(EstadoAusencia).includes(estado)) {
      where.estado = estado;
    }

    const ausencias = await prisma.ausencia.findMany({
      where,
      include: {
        user: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        tipoAusencia: true,
        aprobadoPor: {
          select: { id: true, nombre: true, apellidos: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(ausencias);
  } catch (error) {
    console.error("GET /api/ausencias error:", error);
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
    const body = await request.json();
    const { tipoAusenciaId, fechaInicio, fechaFin, motivo, userId: targetUserId } = body as {
      tipoAusenciaId: string;
      fechaInicio: string;
      fechaFin: string;
      motivo?: string;
      userId?: string;
    };

    if (!tipoAusenciaId || !fechaInicio || !fechaFin) {
      return Response.json(
        { error: "Faltan campos obligatorios: tipoAusenciaId, fechaInicio, fechaFin" },
        { status: 400 }
      );
    }

    // Determine the userId for the absence
    let ausenciaUserId = session.user.id;

    if (targetUserId && targetUserId !== session.user.id) {
      if (userRol === Rol.EMPLEADO) {
        return Response.json(
          { error: "No puedes crear ausencias para otros empleados" },
          { status: 403 }
        );
      }
      // MANAGER can only create for their tienda's employees
      if (userRol === Rol.MANAGER) {
        const targetUser = await prisma.user.findUnique({
          where: { id: targetUserId },
          select: { tiendaId: true },
        });
        const userTiendaId = (session.user as any).tiendaId as string | null;
        if (!targetUser || targetUser.tiendaId !== userTiendaId) {
          return Response.json({ error: "No autorizado para este empleado" }, { status: 403 });
        }
      }
      ausenciaUserId = targetUserId;
    }

    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);

    if (fin < inicio) {
      return Response.json(
        { error: "La fecha de fin no puede ser anterior a la fecha de inicio" },
        { status: 400 }
      );
    }

    const dias = calcularDias(inicio, fin);

    // Verify tipoAusencia exists and is active
    const tipoAusencia = await prisma.tipoAusencia.findUnique({
      where: { id: tipoAusenciaId },
    });
    if (!tipoAusencia || !tipoAusencia.activo) {
      return Response.json({ error: "Tipo de ausencia no válido" }, { status: 400 });
    }

    const ausencia = await prisma.ausencia.create({
      data: {
        userId: ausenciaUserId!,
        tipoAusenciaId,
        fechaInicio: inicio,
        fechaFin: fin,
        dias,
        motivo,
        estado: EstadoAusencia.PENDIENTE,
      },
      include: {
        user: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        tipoAusencia: true,
      },
    });

    return Response.json(ausencia, { status: 201 });
  } catch (error) {
    console.error("POST /api/ausencias error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
