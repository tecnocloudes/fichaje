import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const userId = (session.user as any).id as string;
    const rol = (session.user as any).rol as string;
    const tiendaId = (session.user as any).tiendaId as string | null;

    const hoy = new Date();
    const inicioHoy = new Date(hoy);
    inicioHoy.setHours(0, 0, 0, 0);
    const finHoy = new Date(hoy);
    finHoy.setHours(23, 59, 59, 999);

    // Where clause for employees depending on role
    const empleadosWhere =
      rol === "MANAGER" && tiendaId
        ? { activo: true, tiendaId, rol: "EMPLEADO" as const }
        : { activo: true };

    // Get all employees with their fichajes today and absences today
    const empleados = await prisma.user.findMany({
      where: empleadosWhere,
      select: {
        id: true,
        nombre: true,
        apellidos: true,
        fechaNacimiento: true,
        fichajes: {
          where: { timestamp: { gte: inicioHoy, lte: finHoy } },
          orderBy: { timestamp: "desc" },
          take: 1,
          select: { tipo: true, timestamp: true },
        },
        ausencias: {
          where: {
            fechaInicio: { lte: finHoy },
            fechaFin: { gte: inicioHoy },
            estado: "APROBADA",
          },
          take: 1,
        },
      },
    });

    // Determine who's in
    type StatusKey = "trabajando" | "enPausa" | "sinFichar" | "ausente" | "salida";
    const whosIn: Record<StatusKey, { id: string; nombre: string; apellidos: string }[]> = {
      trabajando: [],
      enPausa: [],
      sinFichar: [],
      ausente: [],
      salida: [],
    };

    for (const emp of empleados) {
      const isAusente = emp.ausencias.length > 0;
      if (isAusente) {
        whosIn.ausente.push({ id: emp.id, nombre: emp.nombre, apellidos: emp.apellidos });
        continue;
      }
      const lastFichaje = emp.fichajes[0];
      if (!lastFichaje) {
        whosIn.sinFichar.push({ id: emp.id, nombre: emp.nombre, apellidos: emp.apellidos });
      } else if (lastFichaje.tipo === "ENTRADA" || lastFichaje.tipo === "VUELTA_PAUSA") {
        whosIn.trabajando.push({ id: emp.id, nombre: emp.nombre, apellidos: emp.apellidos });
      } else if (lastFichaje.tipo === "PAUSA") {
        whosIn.enPausa.push({ id: emp.id, nombre: emp.nombre, apellidos: emp.apellidos });
      } else {
        whosIn.salida.push({ id: emp.id, nombre: emp.nombre, apellidos: emp.apellidos });
      }
    }

    // Upcoming birthdays (next 60 days)
    const proximosCumpleanos: { id: string; nombre: string; apellidos: string; fecha: string; diasRestantes: number }[] = [];
    for (const emp of empleados) {
      if (!emp.fechaNacimiento) continue;
      const fn = new Date(emp.fechaNacimiento);
      const thisYear = new Date(hoy.getFullYear(), fn.getMonth(), fn.getDate());
      if (thisYear < hoy) thisYear.setFullYear(hoy.getFullYear() + 1);
      const diff = Math.ceil((thisYear.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
      if (diff <= 60) {
        proximosCumpleanos.push({
          id: emp.id,
          nombre: emp.nombre,
          apellidos: emp.apellidos,
          fecha: thisYear.toISOString(),
          diasRestantes: diff,
        });
      }
    }
    proximosCumpleanos.sort((a, b) => a.diasRestantes - b.diasRestantes);

    // Upcoming festivos
    const proximosFestivos = await prisma.festivo.findMany({
      where: { fecha: { gte: hoy } },
      orderBy: { fecha: "asc" },
      take: 5,
    });

    // Active tasks
    const tareasActivas = await prisma.tarea.findMany({
      where: {
        completada: false,
        OR: [
          { asignadoAId: userId },
          { creadoPorId: userId },
          ...(rol === "SUPERADMIN" ? [{}] : []),
        ],
      },
      include: {
        asignadoA: { select: { nombre: true, apellidos: true } },
        creadoPor: { select: { nombre: true, apellidos: true } },
      },
      orderBy: [{ fechaLimite: "asc" }, { createdAt: "desc" }],
      take: 5,
    });

    // Pending absences for approval
    const ausenciasPendientes =
      rol !== "EMPLEADO"
        ? await prisma.ausencia.count({
            where: {
              estado: "PENDIENTE",
              ...(rol === "MANAGER" && tiendaId
                ? { user: { tiendaId } }
                : {}),
            },
          })
        : 0;

    // Stats
    const stats = {
      totalEmpleados: empleados.filter((e) => !e.fichajes.length || true).length,
      trabajando: whosIn.trabajando.length,
      enPausa: whosIn.enPausa.length,
      ausentes: whosIn.ausente.length,
      sinFichar: whosIn.sinFichar.length,
      ausenciasPendientes,
    };

    return NextResponse.json({
      whosIn,
      proximosCumpleanos: proximosCumpleanos.slice(0, 5),
      proximosFestivos,
      tareasActivas,
      stats,
    });
  } catch (error) {
    console.error("GET /api/dashboard error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
