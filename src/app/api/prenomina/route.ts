/**
 * GET /api/prenomina?periodo=YYYY-MM
 *   Agrega horas trabajadas por empleado en ese mes, calculadas desde
 *   los pares ENTRADA/SALIDA del modelo Fichaje, restando pausas.
 *   Devuelve también horas extra (sobre las horas teóricas mensuales)
 *   y conteo de ausencias.
 *
 * Sin tabla nueva — todo se calcula on-the-fly. Pensado para exportar
 * a software externo de nóminas o copiar/pegar.
 *
 * Feature: `prenomina` (pro+enterprise). OWNER/MANAGER.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol, TipoFichaje } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const GET = withTenant(withFeature("prenomina", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER && userRol !== Rol.MANAGER) {
    return NextResponse.json({ error: "Solo OWNER/MANAGER" }, { status: 403 });
  }

  const periodo = req.nextUrl.searchParams.get("periodo");
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
    return NextResponse.json({ error: "Parámetro periodo requerido (YYYY-MM)" }, { status: 400 });
  }
  const [yy, mm] = periodo.split("-").map(Number);
  const inicio = new Date(Date.UTC(yy, mm - 1, 1, 0, 0, 0));
  const fin = new Date(Date.UTC(yy, mm, 0, 23, 59, 59));

  const cfg = await prisma.configuracionEmpresa.findUnique({
    where: { id: "singleton" },
    select: { horasJornadaDiaria: true, horasSemanales: true },
  });
  const horasDia = cfg?.horasJornadaDiaria ?? 8;
  // Días laborables aproximados del mes (lunes-viernes).
  let diasLab = 0;
  for (let d = new Date(inicio); d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) diasLab++;
  }
  const horasTeoricas = diasLab * horasDia;

  const fichajes = await prisma.fichaje.findMany({
    where: { timestamp: { gte: inicio, lte: fin } },
    orderBy: [{ userId: "asc" }, { timestamp: "asc" }],
    select: { userId: true, tipo: true, timestamp: true, user: { select: { id: true, nombre: true, apellidos: true, email: true, dni: true } } },
  });

  const ausencias = await prisma.ausencia.findMany({
    where: {
      OR: [
        { fechaInicio: { lte: fin }, fechaFin: { gte: inicio } },
      ],
      estado: "APROBADA",
    },
    select: { userId: true, fechaInicio: true, fechaFin: true },
  });
  const ausPorUser = new Map<string, number>();
  for (const a of ausencias) {
    const s = a.fechaInicio < inicio ? inicio : a.fechaInicio;
    const e = a.fechaFin > fin ? fin : a.fechaFin;
    const diasAus = Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
    ausPorUser.set(a.userId, (ausPorUser.get(a.userId) ?? 0) + diasAus);
  }

  // Agregación por usuario.
  type Row = { userId: string; nombre: string; apellidos: string; email: string; dni: string | null; horasTotales: number; horasExtra: number; diasTrabajados: number; ausencias: number };
  const rows = new Map<string, Row>();
  let activoDesde: Date | null = null;
  let pausaDesde: Date | null = null;
  let pausaAcumMs = 0;
  let lastUserId: string | null = null;
  const diasSet = new Map<string, Set<string>>();

  const finalizarSesion = (userId: string, hasta: Date) => {
    if (!activoDesde) return;
    const dur = hasta.getTime() - activoDesde.getTime() - pausaAcumMs;
    if (dur > 0) {
      const row = rows.get(userId);
      if (row) row.horasTotales += dur / 3_600_000;
      const set = diasSet.get(userId) ?? new Set<string>();
      set.add(activoDesde.toISOString().slice(0, 10));
      diasSet.set(userId, set);
    }
    activoDesde = null; pausaDesde = null; pausaAcumMs = 0;
  };

  for (const f of fichajes) {
    if (lastUserId !== f.userId) {
      // Cerrar sesión del user anterior si quedó abierta.
      if (lastUserId && activoDesde) finalizarSesion(lastUserId, fin);
      lastUserId = f.userId;
    }
    if (!rows.has(f.userId)) {
      rows.set(f.userId, {
        userId: f.userId,
        nombre: f.user.nombre, apellidos: f.user.apellidos,
        email: f.user.email, dni: f.user.dni,
        horasTotales: 0, horasExtra: 0, diasTrabajados: 0,
        ausencias: ausPorUser.get(f.userId) ?? 0,
      });
    }
    if (f.tipo === TipoFichaje.ENTRADA) {
      activoDesde = f.timestamp; pausaAcumMs = 0; pausaDesde = null;
    } else if (f.tipo === TipoFichaje.PAUSA) {
      pausaDesde = f.timestamp;
    } else if (f.tipo === TipoFichaje.VUELTA_PAUSA) {
      if (pausaDesde) { pausaAcumMs += f.timestamp.getTime() - pausaDesde.getTime(); pausaDesde = null; }
    } else if (f.tipo === TipoFichaje.SALIDA) {
      // Si quedó pausa abierta al cerrar, contarla.
      if (pausaDesde) { pausaAcumMs += f.timestamp.getTime() - pausaDesde.getTime(); pausaDesde = null; }
      finalizarSesion(f.userId, f.timestamp);
    }
  }
  if (lastUserId && activoDesde) finalizarSesion(lastUserId, fin);

  for (const [uid, set] of diasSet) {
    const r = rows.get(uid);
    if (r) {
      r.diasTrabajados = set.size;
      r.horasExtra = Math.max(0, r.horasTotales - horasTeoricas);
      r.horasTotales = Math.round(r.horasTotales * 100) / 100;
      r.horasExtra = Math.round(r.horasExtra * 100) / 100;
    }
  }
  // Añadir filas para users con ausencias pero sin fichajes.
  for (const [uid, diasAus] of ausPorUser) {
    if (!rows.has(uid)) {
      const ausencia = ausencias.find((a) => a.userId === uid);
      if (!ausencia) continue;
      const usr = await prisma.user.findUnique({ where: { id: uid }, select: { nombre: true, apellidos: true, email: true, dni: true } });
      if (!usr) continue;
      rows.set(uid, {
        userId: uid, nombre: usr.nombre, apellidos: usr.apellidos, email: usr.email, dni: usr.dni,
        horasTotales: 0, horasExtra: 0, diasTrabajados: 0, ausencias: diasAus,
      });
    }
  }

  return NextResponse.json({
    periodo, horasTeoricas, diasLaborables: diasLab,
    empleados: Array.from(rows.values()).sort((a, b) => a.apellidos.localeCompare(b.apellidos)),
  });
}));
