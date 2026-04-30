/**
 * HOF `withTenant` — envuelve un handler de ruta API con la resolución
 * del tenant + runWithTenant. Mitigación del riesgo §11.3 del plan de
 * Fase 3: en Next 16, el `runWithTenant` que hace `proxy.ts` NO se
 * propaga al handler de la ruta (verificado empíricamente). Por eso
 * cada handler debe re-resolver el tenant y reanidar runWithTenant
 * explícitamente.
 *
 * Coste por request: hit en el cache del resolver (commit 5,
 * `getCachedTenant`), sin tocar BD si el tenant ya estaba cacheado por
 * el proxy.
 *
 * Responsabilidades movidas del proxy a este HOF:
 *  - resolución host → tenant.
 *  - status check (active / pending / suspended / deleted) → códigos
 *    HTTP de defensa en profundidad. El proxy mantiene su propio status
 *    check para parar el request antes de llegar al handler; el HOF
 *    refuerza por si el proxy se olvida o no se ejecuta (defensa en
 *    profundidad).
 *  - JWT cross-validation: el slug del host vs JWT.tenantSlug → 401.
 *
 * Se aplica a los ~40 endpoints en src/app/api/** (excepto whitelist:
 * /api/auth, /api/setup, /api/webhooks, /api/admin, /api/health).
 */

import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { resolveTenant } from "@/lib/tenant/resolver";
import { runWithTenant } from "@/lib/tenant/context";

type Handler<Args extends unknown[]> = (
  req: NextRequest,
  ...rest: Args
) => Promise<Response> | Response;

const STATUS_MAP: Record<
  "pending" | "provisioning" | "suspended" | "deleted",
  { code: number; retry: number | null }
> = {
  pending: { code: 503, retry: 30 },
  provisioning: { code: 503, retry: 30 },
  suspended: { code: 402, retry: null },
  deleted: { code: 410, retry: null },
};

export function withTenant<Args extends unknown[]>(
  handler: Handler<Args>,
): Handler<Args> {
  return async (req, ...rest) => {
    const host = req.headers.get("host") ?? "";
    const resolved = await resolveTenant(host);

    if (resolved.kind !== "tenant") {
      // 404 indistinguible para apex/app/admin/invalid/not_found:
      // estos handlers no deberían recibir tráfico de esos hosts (los
      // intercepta el proxy), pero si llega → 404.
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    const ctx = resolved.ctx;

    if (ctx.status !== "active") {
      const m = STATUS_MAP[ctx.status];
      const headers: HeadersInit = {};
      if (m.retry !== null) headers["Retry-After"] = String(m.retry);
      return NextResponse.json(
        { error: ctx.status },
        { status: m.code, headers },
      );
    }

    // JWT cross-validation: si el JWT viene firmado por otro tenant,
    // 401 (no 403) — ADR-002 §2.5.
    try {
      const token = await getToken({
        req: req as unknown as Parameters<typeof getToken>[0]["req"],
        secret: process.env.AUTH_SECRET,
      });
      if (token && token.tenantSlug && token.tenantSlug !== ctx.slug) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } catch {
      // Si getToken lanza por cualquier razón, no rechazamos por eso
      // (el endpoint puede ser público o el token estar ausente).
    }

    return runWithTenant(ctx, () => handler(req, ...rest));
  };
}
