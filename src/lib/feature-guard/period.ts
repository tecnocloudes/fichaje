/**
 * Cálculo del periodo actual de una quota. ADR-004 §2.3.
 *
 * `master.features.quota_period` es `"mes"` o `"dia"` (NULL en boolean/limit).
 *
 * - "mes": periodo = mes natural (00:00 día 1 hasta 00:00 día 1 del siguiente).
 * - "dia": periodo = día natural (00:00 hoy hasta 00:00 mañana).
 *
 * Convención: hora local del proceso server (igual que `tenants-provision.ts`
 * antes del refactor). Decidir UTC vs local es responsabilidad del operador
 * de despliegue — si el server vive en TZ Europe/Madrid, el reset se observa
 * a medianoche peninsular. Si en Fase 9 se ve drift por DST, mover a UTC en
 * un solo punto (este helper) y migrar las filas existentes.
 *
 * Compartido por:
 * - `scripts/tenants-provision.ts` al sembrar `tenant_quota_usage`.
 * - `src/app/api/me/features/route.ts` al sintetizar quotas sin fila.
 *
 * Si los dos cálculos divergen, el endpoint mostraría un `resetAt` que no
 * coincide con la fila real cuando se cree, así que SIEMPRE usar este helper.
 */

export type QuotaPeriod = "mes" | "dia";

export type Period = {
  start: Date;
  end: Date;
};

export function computeCurrentPeriod(period: QuotaPeriod, now: Date = new Date()): Period {
  if (period === "mes") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
  }
  if (period === "dia") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { start, end };
  }
  throw new Error(`computeCurrentPeriod: período no soportado: ${JSON.stringify(period)}`);
}

export function isQuotaPeriod(value: unknown): value is QuotaPeriod {
  return value === "mes" || value === "dia";
}
