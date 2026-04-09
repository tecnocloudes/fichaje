import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol, TipoFichaje } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

type TipoInforme = "fichajes" | "ausencias" | "turnos" | "resumen" | "presencia" | "presencia-global";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const tipo = searchParams.get("tipo") as TipoInforme | null;
    const tiendaId = searchParams.get("tiendaId");
    const userId = searchParams.get("userId");
    const fechaInicio = searchParams.get("fechaInicio");
    const fechaFin = searchParams.get("fechaFin");

    const tiposValidos = ["fichajes", "ausencias", "turnos", "resumen", "presencia", "presencia-global"];
    if (!tipo || !tiposValidos.includes(tipo)) {
      return Response.json(
        { error: "Parámetro 'tipo' inválido" },
        { status: 400 }
      );
    }

    // presencia y presencia-global no necesitan fechas
    if (!["presencia", "presencia-global"].includes(tipo) && (!fechaInicio || !fechaFin)) {
      return Response.json(
        { error: "Los parámetros fechaInicio y fechaFin son obligatorios" },
        { status: 400 }
      );
    }

    const userRol = (session.user as any).rol as Rol;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    const inicio = fechaInicio ? new Date(fechaInicio) : null;
    if (inicio) inicio.setHours(0, 0, 0, 0);
    const fin = fechaFin ? new Date(fechaFin) : null;
    if (fin) fin.setHours(23, 59, 59, 999);

    // Build base filters depending on role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const roleFilter: any = {};
    if (userRol === Rol.SUPERADMIN) {
      if (tiendaId) roleFilter.tiendaId = tiendaId;
      if (userId) roleFilter.userId = userId;
    } else if (userRol === Rol.MANAGER) {
      roleFilter.tiendaId = userTiendaId;
      if (userId) roleFilter.userId = userId;
    } else {
      // EMPLEADO
      roleFilter.userId = session.user.id;
    }

    if (tipo === "fichajes") {
      return await informeFichajes(roleFilter, inicio!, fin!);
    }

    if (tipo === "ausencias") {
      return await informeAusencias(roleFilter, inicio!, fin!, userRol);
    }

    if (tipo === "turnos") {
      return await informeTurnos(roleFilter, inicio!, fin!);
    }

    if (tipo === "resumen") {
      return await informeResumen(roleFilter, inicio!, fin!, userRol, userTiendaId, tiendaId, userId);
    }

    if (tipo === "presencia") {
      const fecha = searchParams.get("fecha") || new Date().toISOString().split("T")[0];
      return await informePresencia(roleFilter, userRol, userTiendaId, fecha);
    }

    if (tipo === "presencia-global") {
      if (userRol !== Rol.SUPERADMIN) {
        return Response.json({ error: "No autorizado" }, { status: 403 });
      }
      return await informePresenciaGlobal();
    }

    return Response.json({ error: "Tipo de informe no implementado" }, { status: 400 });
  } catch (error) {
    console.error("GET /api/informes error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

async function informeFichajes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleFilter: any,
  inicio: Date,
  fin: Date
) {
  const fichajes = await prisma.fichaje.findMany({
    where: {
      ...roleFilter,
      timestamp: { gte: inicio, lte: fin },
    },
    include: {
      user: {
        select: { id: true, nombre: true, apellidos: true, email: true },
      },
      tienda: {
        select: { id: true, nombre: true },
      },
    },
    orderBy: [{ userId: "asc" }, { timestamp: "asc" }],
  });

  return Response.json({ tipo: "fichajes", data: fichajes, total: fichajes.length });
}

async function informeAusencias(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleFilter: any,
  inicio: Date,
  fin: Date,
  userRol: Rol
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    fechaInicio: { lte: fin },
    fechaFin: { gte: inicio },
  };

  if (userRol === Rol.SUPERADMIN) {
    if (roleFilter.tiendaId) where.user = { tiendaId: roleFilter.tiendaId };
    if (roleFilter.userId) where.userId = roleFilter.userId;
  } else if (userRol === Rol.MANAGER) {
    where.user = { tiendaId: roleFilter.tiendaId };
    if (roleFilter.userId) where.userId = roleFilter.userId;
  } else {
    where.userId = roleFilter.userId;
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
    orderBy: [{ userId: "asc" }, { fechaInicio: "asc" }],
  });

  return Response.json({ tipo: "ausencias", data: ausencias, total: ausencias.length });
}

async function informeTurnos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleFilter: any,
  inicio: Date,
  fin: Date
) {
  const turnos = await prisma.turno.findMany({
    where: {
      ...roleFilter,
      fecha: { gte: inicio, lte: fin },
    },
    include: {
      user: {
        select: { id: true, nombre: true, apellidos: true, email: true },
      },
      tienda: {
        select: { id: true, nombre: true },
      },
    },
    orderBy: [{ userId: "asc" }, { fecha: "asc" }],
  });

  return Response.json({ tipo: "turnos", data: turnos, total: turnos.length });
}

async function informeResumen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleFilter: any,
  inicio: Date,
  fin: Date,
  userRol: Rol,
  userTiendaId: string | null,
  tiendaId: string | null,
  userId: string | null
) {
  // Build user filter for the summary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userWhere: any = { activo: true };
  if (userRol === Rol.SUPERADMIN) {
    if (tiendaId) userWhere.tiendaId = tiendaId;
    if (userId) userWhere.id = userId;
  } else if (userRol === Rol.MANAGER) {
    userWhere.tiendaId = userTiendaId;
    if (userId) userWhere.id = userId;
  } else {
    userWhere.id = roleFilter.userId;
  }

  const empleados = await prisma.user.findMany({
    where: userWhere,
    select: {
      id: true,
      nombre: true,
      apellidos: true,
      email: true,
      tienda: { select: { id: true, nombre: true } },
    },
  });

  // Fetch fichajes and ausencias for all relevant users
  const empleadoIds = empleados.map((e) => e.id);

  const [fichajes, ausencias] = await Promise.all([
    prisma.fichaje.findMany({
      where: {
        userId: { in: empleadoIds },
        timestamp: { gte: inicio, lte: fin },
      },
      orderBy: [{ userId: "asc" }, { timestamp: "asc" }],
    }),
    prisma.ausencia.findMany({
      where: {
        userId: { in: empleadoIds },
        estado: "APROBADA",
        fechaInicio: { lte: fin },
        fechaFin: { gte: inicio },
      },
      include: { tipoAusencia: { select: { nombre: true, pagada: true } } },
    }),
  ]);

  // Group fichajes by user
  const fichajesByUser = new Map<string, typeof fichajes>();
  for (const fichaje of fichajes) {
    const existing = fichajesByUser.get(fichaje.userId) ?? [];
    existing.push(fichaje);
    fichajesByUser.set(fichaje.userId, existing);
  }

  // Group ausencias by user
  const ausenciasByUser = new Map<string, typeof ausencias>();
  for (const ausencia of ausencias) {
    const existing = ausenciasByUser.get(ausencia.userId) ?? [];
    existing.push(ausencia);
    ausenciasByUser.set(ausencia.userId, existing);
  }

  // Calculate stats per employee
  const resumen = empleados.map((empleado) => {
    const userFichajes = fichajesByUser.get(empleado.id) ?? [];
    const userAusencias = ausenciasByUser.get(empleado.id) ?? [];

    // Calculate total minutes worked from fichajes
    let totalMinutos = 0;
    let periodoInicio: Date | null = null;

    for (const fichaje of userFichajes) {
      if (
        fichaje.tipo === TipoFichaje.ENTRADA ||
        fichaje.tipo === TipoFichaje.VUELTA_PAUSA
      ) {
        periodoInicio = fichaje.timestamp;
      } else if (
        (fichaje.tipo === TipoFichaje.PAUSA ||
          fichaje.tipo === TipoFichaje.SALIDA) &&
        periodoInicio !== null
      ) {
        totalMinutos += Math.floor(
          (fichaje.timestamp.getTime() - periodoInicio.getTime()) / 60000
        );
        periodoInicio = null;
      }
    }

    const totalHoras = Math.round((totalMinutos / 60) * 100) / 100;

    // Count ausencias
    const totalDiasAusencia = userAusencias.reduce((acc, a) => acc + a.dias, 0);
    const diasPorTipo = userAusencias.reduce(
      (acc, a) => {
        const key = a.tipoAusencia.nombre;
        acc[key] = (acc[key] ?? 0) + a.dias;
        return acc;
      },
      {} as Record<string, number>
    );

    // Count fichajes
    const totalFichajes = userFichajes.length;
    const diasTrabajados = new Set(
      userFichajes
        .filter((f) => f.tipo === TipoFichaje.ENTRADA)
        .map((f) => f.timestamp.toISOString().split("T")[0])
    ).size;

    return {
      empleado,
      totalHoras,
      totalMinutos,
      diasTrabajados,
      totalFichajes,
      totalDiasAusencia,
      diasPorTipo,
    };
  });

  const totalHorasGlobal = resumen.reduce((acc, e) => acc + e.totalHoras, 0);
  const diasTotales = resumen.reduce((acc, e) => acc + e.diasTrabajados, 0);
  const stats = {
    totalHoras: Math.round(totalHorasGlobal * 10) / 10,
    mediaHorasDia: diasTotales > 0 ? Math.round((totalHorasGlobal / diasTotales) * 10) / 10 : 0,
    horasExtra: Math.max(0, Math.round((totalHorasGlobal - resumen.length * 8 * diasTotales / Math.max(resumen.length, 1)) * 10) / 10),
    totalAusencias: resumen.reduce((acc, e) => acc + e.totalDiasAusencia, 0),
  };

  const empleadosResumen = resumen.map((e) => ({
    userId: e.empleado.id,
    nombre: e.empleado.nombre,
    apellidos: e.empleado.apellidos,
    diasTrabajados: e.diasTrabajados,
    horasTotales: e.totalHoras,
    horasExtra: Math.max(0, e.totalHoras - e.diasTrabajados * 8),
    diasAusencia: e.totalDiasAusencia,
  }));

  return Response.json({ tipo: "resumen", empleados: empleadosResumen, stats, total: empleados.length });
}

async function informePresencia(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleFilter: any,
  userRol: Rol,
  userTiendaId: string | null,
  fecha: string
) {
  const diaInicio = new Date(fecha + "T00:00:00");
  const diaFin = new Date(fecha + "T23:59:59");

  const whereEmpleados: any = { activo: true, rol: { not: "SUPERADMIN" } };
  if (userRol === Rol.MANAGER) whereEmpleados.tiendaId = userTiendaId;
  if (roleFilter.tiendaId) whereEmpleados.tiendaId = roleFilter.tiendaId;

  const empleados = await prisma.user.findMany({
    where: whereEmpleados,
    select: { id: true, nombre: true, apellidos: true, tiendaId: true },
  });

  const fichajes = await prisma.fichaje.findMany({
    where: {
      userId: { in: empleados.map((e) => e.id) },
      timestamp: { gte: diaInicio, lte: diaFin },
    },
    orderBy: { timestamp: "asc" },
  });

  const fichajesPorUser = new Map<string, typeof fichajes>();
  for (const f of fichajes) {
    const arr = fichajesPorUser.get(f.userId) || [];
    arr.push(f);
    fichajesPorUser.set(f.userId, arr);
  }

  const resultado = empleados.map((emp) => {
    const uFichajes = fichajesPorUser.get(emp.id) || [];
    const ultimo = uFichajes[uFichajes.length - 1];
    let estado: "trabajando" | "en_pausa" | "sin_fichar" = "sin_fichar";
    let horaEntrada: string | undefined;
    let totalMin = 0;
    let periodoIn: Date | null = null;

    for (const f of uFichajes) {
      if (f.tipo === "ENTRADA" || f.tipo === "VUELTA_PAUSA") {
        if (f.tipo === "ENTRADA") horaEntrada = f.timestamp.toISOString();
        periodoIn = f.timestamp;
      } else if ((f.tipo === "PAUSA" || f.tipo === "SALIDA") && periodoIn) {
        totalMin += Math.floor((f.timestamp.getTime() - periodoIn.getTime()) / 60000);
        periodoIn = null;
      }
    }
    if (periodoIn) {
      totalMin += Math.floor((new Date().getTime() - periodoIn.getTime()) / 60000);
    }

    if (ultimo) {
      if (ultimo.tipo === "ENTRADA" || ultimo.tipo === "VUELTA_PAUSA") estado = "trabajando";
      else if (ultimo.tipo === "PAUSA") estado = "en_pausa";
      else estado = "sin_fichar";
    }

    return {
      id: emp.id,
      nombre: emp.nombre,
      apellidos: emp.apellidos,
      estado,
      horaEntrada,
      horasHoy: Math.round((totalMin / 60) * 10) / 10,
      fichajes: uFichajes.map((f) => ({ tipo: f.tipo, timestamp: f.timestamp })),
    };
  });

  return Response.json({ empleados: resultado });
}

async function informePresenciaGlobal() {
  const hoyInicio = new Date();
  hoyInicio.setHours(0, 0, 0, 0);
  const hoyFin = new Date();
  hoyFin.setHours(23, 59, 59, 999);

  const [tiendas, fichajosHoy, ausenciasHoy] = await Promise.all([
    prisma.tienda.findMany({
      where: { activa: true },
      include: { _count: { select: { empleados: { where: { activo: true, rol: { not: "SUPERADMIN" } } } } } },
    }),
    prisma.fichaje.findMany({
      where: { timestamp: { gte: hoyInicio, lte: hoyFin } },
      select: { userId: true, tipo: true, timestamp: true, tiendaId: true },
      orderBy: { timestamp: "asc" },
    }),
    prisma.ausencia.findMany({
      where: {
        estado: "APROBADA",
        fechaInicio: { lte: hoyFin },
        fechaFin: { gte: hoyInicio },
      },
      select: { userId: true },
    }),
  ]);

  // Determine current state per user
  const estadoPorUser = new Map<string, string>();
  const fichajesOrdenados = [...fichajosHoy].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const ultimoPorUser = new Map<string, string>();
  for (const f of fichajesOrdenados) {
    ultimoPorUser.set(f.userId, f.tipo);
  }
  for (const [userId, tipo] of ultimoPorUser) {
    if (tipo === "ENTRADA" || tipo === "VUELTA_PAUSA") estadoPorUser.set(userId, "trabajando");
    else if (tipo === "PAUSA") estadoPorUser.set(userId, "en_pausa");
    else estadoPorUser.set(userId, "sin_fichar");
  }

  const ausentesIds = new Set(ausenciasHoy.map((a) => a.userId));

  const tiendasStats = tiendas.map((t) => {
    const fichajesTienda = fichajosHoy.filter((f) => f.tiendaId === t.id);
    const usersTienda = new Set(fichajesTienda.map((f) => f.userId));
    let trabajando = 0, enPausa = 0, sinFichar = 0;

    for (const userId of usersTienda) {
      const estado = estadoPorUser.get(userId);
      if (estado === "trabajando") trabajando++;
      else if (estado === "en_pausa") enPausa++;
    }
    sinFichar = Math.max(0, t._count.empleados - trabajando - enPausa);
    const presenciaPct = t._count.empleados > 0
      ? Math.round(((trabajando + enPausa) / t._count.empleados) * 100)
      : 0;

    return {
      id: t.id, nombre: t.nombre, color: t.color,
      totalEmpleados: t._count.empleados,
      trabajando, enPausa, sinFichar,
      ausentes: [...ausentesIds].filter((id) => fichajesTienda.some((f) => f.userId === id) || true).length,
      presenciaPct,
    };
  });

  const totalEmpleados = tiendasStats.reduce((a, t) => a + t.totalEmpleados, 0);
  const fichadosAhora = tiendasStats.reduce((a, t) => a + t.trabajando + t.enPausa, 0);

  return Response.json({
    tiendas: tiendasStats,
    stats: {
      totalTiendas: tiendas.length,
      totalEmpleados,
      fichadosAhora,
      ausentesHoy: ausentesIds.size,
    },
  });
}
