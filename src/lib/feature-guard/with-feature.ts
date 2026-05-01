/**
 * HOF `withFeature(key, handler)` — server-side enforcement de
 * features booleanas (y limits). ADR-004 §2.8 + plan Fase 5 §2.
 *
 * Composabilidad obligatoria:
 *
 *   withTenant → withFeature → withQuota → handler
 *
 * Si la feature no está en `currentTenant().features` con value
 * truthy, devuelve **402 Payment Required** con `{ error,
 * feature_key, upgrade_url }`.
 *
 * Lectura: `hasFeature(key)` lee del Map precargado por `withTenant`
 * — NO toca BD.
 */

import { type NextRequest, NextResponse } from "next/server";
import { hasFeature } from "@/lib/tenant/features";

type Handler<Args extends unknown[]> = (
  req: NextRequest,
  ...rest: Args
) => Promise<Response> | Response;

export function withFeature<Args extends unknown[]>(
  key: string,
  handler: Handler<Args>,
): Handler<Args> {
  return async (req, ...rest) => {
    // hasFeature(key) lanza con mensaje útil si no hay tenant en
    // contexto (= se llamó fuera de withTenant). Test del orden
    // de composición lo verifica.
    if (!hasFeature(key)) {
      return NextResponse.json(
        {
          error: "feature_required",
          feature_key: key,
          upgrade_url: `/admin/configuracion/facturacion?upgrade=${encodeURIComponent(key)}`,
        },
        { status: 402 },
      );
    }
    return handler(req, ...rest);
  };
}
