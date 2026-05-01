/**
 * GET /api/analytics — KPIs básicos del tenant.
 * Plan D.4.
 *
 * Devuelve:
 *  - empleadosActivos
 *  - tiendasActivas
 *  - fichajesUltimos30d
 *  - ausenciasAprobadas30d
 *  - mediaHorasPorDiaUltimos30d (calculado con ENTRADA/SALIDA pairs)
 *  - turnover30d (ratio bajas/total) — placeholder Fase 9.
 *
 * Sin paginación (KPIs agregados). Cobertura people_analytics.
 */

import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const GET = withTenant(
  withFeature("people_analytics", async () => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const now = new Date();
    const hace30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [empActivos, tiendasActivas, fichajes30d, ausencias30d] =
      await Promise.all([
        prismaApp.user.count({ where: { activo: true } }),
        prismaApp.tienda.count({ where: { activa: true } }),
        prismaApp.fichaje.count({
          where: { timestamp: { gte: hace30 } },
        }),
        prismaApp.ausencia.count({
          where: {
            estado: "APROBADA",
            fechaInicio: { gte: hace30 },
          },
        }),
      ]);

    // Aproximación rápida horas: count(SALIDA) * 8h / 30 días.
    // Cálculo exacto pareando ENTRADA/SALIDA en query SQL es Fase 9.
    const salidas30d = await prismaApp.fichaje.count({
      where: { tipo: "SALIDA", timestamp: { gte: hace30 } },
    });
    const horasPorDiaAprox =
      empActivos > 0
        ? Math.round(((salidas30d * 8) / (empActivos * 30)) * 10) / 10
        : 0;

    return NextResponse.json({
      empleadosActivos: empActivos,
      tiendasActivas,
      fichajesUltimos30d: fichajes30d,
      ausenciasAprobadas30d: ausencias30d,
      horasPorDiaAprox,
      // Placeholder — turnover requiere bajas históricas (Fase 9).
      turnover30d: null,
    });
  }),
);
