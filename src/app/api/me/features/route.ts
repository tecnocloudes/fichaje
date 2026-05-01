/**
 * GET /api/me/features — devuelve la matriz de features del tenant.
 * ADR-004 §2.6 + plan Fase 5 §4.
 *
 * Shape de respuesta:
 *
 * {
 *   "booleans": { "geofencing": true, "export_csv": true, ... },
 *   "limits":   {
 *     "max_employees":   { "current": 12, "max": 50 },
 *     "max_tiendas":     { "current": 2,  "max": 5 },
 *     "historial_meses": { "max": 36 },          // sin current
 *     "max_storage_mb":  { "max": 5000 }         // sin current
 *   },
 *   "quotas":   {
 *     "emails_mes":  { "used": 230, "max": 5000, "resetAt": "..." },
 *     ...
 *   }
 * }
 *
 * `current` opt-in: solo `max_employees` y `max_tiendas` (plan §15.3).
 * Los otros limits se exponen sin `current`.
 *
 * Cliente cachea en sessionStorage (5 min). Hook useFeatures (commit 7).
 */

import { withTenant } from "@/lib/tenant/with-tenant";
import { currentTenant } from "@/lib/tenant/context";
import { prismaApp, prismaRuntime } from "@/lib/prisma";
import { NextResponse } from "next/server";
import type { ResolvedFeature } from "@/lib/tenant/features";

type LimitOut = { current?: number; max: number | null };
type QuotaOut = { used: number; max: number | null; resetAt: string };

/**
 * Loaders del campo `current` para limits — solo los que pueden
 * calcularse con un count barato. Ver plan §15.3.
 */
const LIMIT_CURRENT_LOADERS: Record<string, () => Promise<number>> = {
  max_employees: () => prismaApp.user.count({ where: { activo: true } }),
  max_tiendas: () => prismaApp.tienda.count({ where: { activa: true } }),
};

export const GET = withTenant(async () => {
  const ctx = currentTenant();

  const booleans: Record<string, boolean> = {};
  const limits: Record<string, LimitOut> = {};

  // Recorrer el Map ya cargado por withTenant.
  for (const [key, feature] of ctx.features.entries()) {
    classifyFeature(key, feature, booleans, limits);
  }

  // Calcular `current` opt-in para los limits con loader.
  for (const [key, loader] of Object.entries(LIMIT_CURRENT_LOADERS)) {
    if (limits[key]) {
      try {
        limits[key].current = await loader();
      } catch {
        // Loader falló (e.g. tabla aún no migrada en tenant nuevo).
        // Omitir current — el front no muestra barra de progreso.
      }
    }
  }

  // Quotas desde master.tenant_quota_usage (rol read-only).
  const now = new Date();
  const usageRows = await prismaRuntime.tenantQuotaUsage.findMany({
    where: {
      tenantId: ctx.tenantId,
      periodStart: { lte: now },
      periodEnd: { gt: now },
    },
  });
  const quotas: Record<string, QuotaOut> = {};
  for (const row of usageRows) {
    quotas[row.featureKey] = {
      used: Number(row.consumed),
      max: row.max === null ? null : Number(row.max),
      resetAt: row.periodEnd.toISOString(),
    };
  }

  return NextResponse.json({ booleans, limits, quotas });
});

function classifyFeature(
  key: string,
  feature: ResolvedFeature,
  booleans: Record<string, boolean>,
  limits: Record<string, LimitOut>,
): void {
  if (typeof feature.value === "boolean") {
    booleans[key] = feature.value;
  } else {
    // value: number | null — limit (numérico) o unlimited (null).
    limits[key] = { max: feature.value };
  }
}
