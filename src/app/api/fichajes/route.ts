import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TipoFichaje, MetodoFichaje, Rol } from "@/generated/prisma/client";
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
    const fecha = searchParams.get("fecha");

    const userRol = (session.user as any).rol as Rol;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    // Build where clause based on role
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

    if (fecha) {
      const start = new Date(fecha);
      start.setHours(0, 0, 0, 0);
      const end = new Date(fecha);
      end.setHours(23, 59, 59, 999);
      where.timestamp = { gte: start, lte: end };
    }

    const fichajes = await prisma.fichaje.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            nombre: true,
            apellidos: true,
            email: true,
          },
        },
        tienda: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
      orderBy: { timestamp: "desc" },
    });

    return Response.json(fichajes);
  } catch (error) {
    console.error("GET /api/fichajes error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const {
      tipo,
      latitud,
      longitud,
      distancia,
      metodo = MetodoFichaje.WEB,
      nota,
    } = body as {
      tipo: TipoFichaje;
      latitud?: number;
      longitud?: number;
      distancia?: number;
      metodo?: MetodoFichaje;
      nota?: string;
    };

    if (!tipo || !Object.values(TipoFichaje).includes(tipo)) {
      return Response.json({ error: "Tipo de fichaje inválido" }, { status: 400 });
    }

    const userId = session.user.id;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    // Get the last fichaje to validate state transitions
    const ultimoFichaje = await prisma.fichaje.findFirst({
      where: { userId },
      orderBy: { timestamp: "desc" },
    });

    const ultimoTipo = ultimoFichaje?.tipo ?? null;

    // Validate state transitions
    const validationError = validateTipoFichaje(tipo, ultimoTipo);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    // Get IP from headers
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0].trim() : null;

    const fichaje = await prisma.fichaje.create({
      data: {
        userId: userId!,
        tiendaId: userTiendaId,
        tipo,
        latitud,
        longitud,
        distancia,
        metodo,
        nota,
        ip,
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

    return Response.json(fichaje, { status: 201 });
  } catch (error) {
    console.error("POST /api/fichajes error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

function validateTipoFichaje(
  tipo: TipoFichaje,
  ultimoTipo: TipoFichaje | null
): string | null {
  // If no previous fichaje (no active session), only ENTRADA is allowed
  if (ultimoTipo === null || ultimoTipo === TipoFichaje.SALIDA) {
    if (tipo !== TipoFichaje.ENTRADA) {
      return "Debes hacer ENTRADA antes de registrar otro fichaje";
    }
    return null;
  }

  if (ultimoTipo === TipoFichaje.ENTRADA || ultimoTipo === TipoFichaje.VUELTA_PAUSA) {
    if (tipo === TipoFichaje.ENTRADA) {
      return "Ya tienes una entrada activa. Debes hacer SALIDA primero";
    }
    if (tipo === TipoFichaje.VUELTA_PAUSA) {
      return "No estás en pausa. No puedes hacer VUELTA_PAUSA";
    }
    return null; // PAUSA or SALIDA are valid
  }

  if (ultimoTipo === TipoFichaje.PAUSA) {
    if (tipo === TipoFichaje.ENTRADA) {
      return "Ya tienes una entrada activa. Debes hacer SALIDA primero";
    }
    if (tipo === TipoFichaje.PAUSA) {
      return "Ya estás en pausa";
    }
    if (tipo === TipoFichaje.SALIDA) {
      return "Debes hacer VUELTA_PAUSA antes de SALIDA";
    }
    return null; // VUELTA_PAUSA is valid
  }

  return null;
}
