/**
 * HOF `withQuota(key, n, handler)` — server-side enforcement de
 * quotas. ADR-004 §2.5 + §2.8 + plan Fase 5 §2.
 *
 * Composabilidad obligatoria:
 *
 *   withTenant → withFeature → withQuota → handler
 *
 * `withQuota` es el ÚNICO de los HOFs que toca BD (UPDATE atómico
 * sobre `master.tenant_quota_usage` con `quota_writer_role`). Por eso
 * va DESPUÉS de `withFeature`: no consumimos quota de features no
 * contratadas.
 *
 * Mapping de errores (ADR-004 §2.5 enmienda 3):
 *
 * - `period_unavailable` (sin fila vigente — handler de Stripe aún
 *   no creó periodo): 429 + `Retry-After: 30`. Cliente reintenta.
 * - `limit_reached` (consumed + n > max): 429 + `Retry-After: <hasta
 *   resetAt>`. Cliente sabe cuándo volver.
 */

import { type NextRequest, NextResponse } from "next/server";
import { consumeQuota } from "@/lib/tenant/features";

type Handler<Args extends unknown[]> = (
  req: NextRequest,
  ...rest: Args
) => Promise<Response> | Response;

function secondsUntil(date: Date): number {
  const ms = date.getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 1000));
}

export function withQuota<Args extends unknown[]>(
  key: string,
  amount: number,
  handler: Handler<Args>,
): Handler<Args> {
  return async (req, ...rest) => {
    const result = await consumeQuota(key, amount);

    if (result.ok) {
      return handler(req, ...rest);
    }

    if (result.reason === "period_unavailable") {
      return NextResponse.json(
        {
          error: "quota_period_unavailable",
          feature_key: key,
          message: "Tu plan está siendo activado. Reintenta en unos segundos.",
        },
        { status: 429, headers: { "Retry-After": "30" } },
      );
    }

    // result.reason === "limit_reached"
    return NextResponse.json(
      {
        error: "quota_exceeded",
        feature_key: key,
        used: result.used,
        max: result.max,
        reset_at: result.resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { "Retry-After": String(secondsUntil(result.resetAt)) },
      },
    );
  };
}
