/**
 * HOF para handlers /api/v1/**. Combina:
 *  - withTenant (resuelve tenant del host).
 *  - hasFeature("api_access").
 *  - authenticateApiToken (Bearer del Authorization).
 *  - consumeQuota("api_calls_dia", 1).
 *  - JSON estandarizado de errores.
 *
 * Plan D.1.
 */

import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { hasFeature, consumeQuota } from "@/lib/tenant/features";
import { currentTenant } from "@/lib/tenant/context";
import { authenticateApiToken } from "./auth";

type Handler<Args extends unknown[]> = (
  req: NextRequest,
  ...rest: Args
) => Promise<Response> | Response;

function secondsUntil(date: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));
}

export function withApiV1<Args extends unknown[]>(
  handler: Handler<Args>,
): Handler<Args> {
  return withTenant(async (req: NextRequest, ...rest: Args) => {
    if (!hasFeature("api_access")) {
      return NextResponse.json(
        { error: "feature_required", feature_key: "api_access" },
        { status: 402 },
      );
    }
    const ctx = currentTenant();
    const auth = await authenticateApiToken(req.headers, ctx.tenantId);
    if (!auth.ok) {
      return NextResponse.json(
        { error: "unauthorized", reason: auth.reason },
        { status: 401 },
      );
    }
    const consume = await consumeQuota("api_calls_dia", 1);
    if (!consume.ok) {
      if (consume.reason === "period_unavailable") {
        return NextResponse.json(
          { error: "period_unavailable", feature_key: "api_calls_dia" },
          { status: 429, headers: { "Retry-After": "30" } },
        );
      }
      return NextResponse.json(
        {
          error: "rate_limit_exceeded",
          feature_key: "api_calls_dia",
          used: consume.used,
          max: consume.max,
          resetAt: consume.resetAt.toISOString(),
        },
        {
          status: 429,
          headers: { "Retry-After": String(secondsUntil(consume.resetAt)) },
        },
      );
    }
    return handler(req, ...rest);
  }) as Handler<Args>;
}
