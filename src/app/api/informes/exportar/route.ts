/**
 * GET /api/informes/exportar?formato={csv|xlsx|pdf}&...
 * Plan Fase 5 §5.1, coverage `informes/exportar/route.ts`.
 *
 * Feature-gated por formato + consume quota mensual de exports.
 *
 * Por qué check inline en vez de `withFeature(KEY, handler)`:
 * el feature key (`export_csv` | `export_excel` | `export_pdf`) depende
 * del query param `formato`, así que no es estático en la composición.
 * `hasFeature(key)` + `consumeQuota("exports_mes", 1)` aplican la
 * misma semántica que los HOFs (402 + Retry-After) sin requerir 3
 * subrutas separadas. El orden inviolable §15.6 se preserva:
 * withTenant → check feature → consume quota → handler.
 *
 * Generación real de CSV/Excel/PDF: TODO Fase 9. Por ahora devuelve
 * el mismo JSON que `/api/informes` con headers de descarga, para
 * desacoplar el feature gate del generador.
 */

import { auth } from "@/lib/auth";
import { hasFeature, consumeQuota } from "@/lib/tenant/features";
import { NextResponse, type NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";

const FORMATO_TO_FEATURE: Record<string, string> = {
  csv: "export_csv",
  xlsx: "export_excel",
  pdf: "export_pdf",
};

function secondsUntil(date: Date, now: Date = new Date()): number {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1000));
}

export const GET = withTenant(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const formato = searchParams.get("formato") ?? "csv";
  const featureKey = FORMATO_TO_FEATURE[formato];
  if (!featureKey) {
    return NextResponse.json(
      { error: "formato_invalido", allowed: Object.keys(FORMATO_TO_FEATURE) },
      { status: 400 },
    );
  }

  // 1. Feature gate.
  if (!hasFeature(featureKey)) {
    return NextResponse.json(
      {
        error: "feature_required",
        feature_key: featureKey,
        upgrade_url: `/admin/configuracion/facturacion?upgrade=${encodeURIComponent(featureKey)}`,
      },
      { status: 402 },
    );
  }

  // 2. Consumir quota de exports.
  const consumeResult = await consumeQuota("exports_mes", 1);
  if (!consumeResult.ok) {
    if (consumeResult.reason === "period_unavailable") {
      return NextResponse.json(
        { error: "period_unavailable", feature_key: "exports_mes" },
        { status: 429, headers: { "Retry-After": "30" } },
      );
    }
    return NextResponse.json(
      {
        error: "limit_reached",
        feature_key: "exports_mes",
        used: consumeResult.used,
        max: consumeResult.max,
        resetAt: consumeResult.resetAt.toISOString(),
        upgrade_url: "/admin/configuracion/facturacion?upgrade=exports_mes",
      },
      {
        status: 429,
        headers: { "Retry-After": String(secondsUntil(consumeResult.resetAt)) },
      },
    );
  }

  // 3. Delegar a /api/informes (mismo handler) para los datos.
  // Reescribimos la URL preservando query params (sin formato) y
  // hacemos un fetch interno. Sin redirect — el cliente espera blob.
  // Limpio: el origen = mismo host del request original.
  const proxiedUrl = new URL(req.url);
  proxiedUrl.pathname = "/api/informes";
  proxiedUrl.searchParams.delete("formato");
  const proxied = await fetch(proxiedUrl, {
    headers: req.headers,
  });
  if (!proxied.ok) {
    return NextResponse.json(
      { error: "informes_failed", status: proxied.status },
      { status: 500 },
    );
  }
  const data = await proxied.text();

  // TODO Fase 9: generar CSV/Excel/PDF real desde JSON.
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": mimeTypeFor(formato),
      "Content-Disposition": `attachment; filename="informe.${formato}"`,
    },
  });
});

function mimeTypeFor(formato: string): string {
  if (formato === "csv") return "text/csv; charset=utf-8";
  if (formato === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (formato === "pdf") return "application/pdf";
  return "application/octet-stream";
}
