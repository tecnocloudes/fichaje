/**
 * GET /api/informes/exportar?formato={csv|xlsx|pdf}&...
 * Plan Fase 5 §5.1 + cierre A.2.
 *
 * Feature-gated por formato + consume quota mensual de exports + genera
 * archivo real (CSV/Excel/PDF) desde el JSON de `/api/informes`.
 *
 * Por qué check inline en vez de `withFeature(KEY, handler)`:
 * el feature key (`export_csv` | `export_excel` | `export_pdf`) depende
 * del query param `formato`, así que no es estático en la composición.
 * `hasFeature(key)` + `consumeQuota("exports_mes", 1)` aplican la
 * misma semántica que los HOFs (402 + Retry-After) sin requerir 3
 * subrutas separadas. El orden inviolable §15.6 se preserva:
 * withTenant → check feature → consume quota → handler.
 *
 * Generación: `src/lib/informes/generators.ts` aplana el JSON, extrae
 * columnas estables y produce el blob según formato.
 */

import { auth } from "@/lib/auth";
import { hasFeature, consumeQuota } from "@/lib/tenant/features";
import { NextResponse, type NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import {
  generarCSV,
  generarExcel,
  generarPDF,
  type InformePayload,
} from "@/lib/informes/generators";

const FORMATO_TO_FEATURE: Record<string, string> = {
  csv: "export_csv",
  xlsx: "export_excel",
  pdf: "export_pdf",
};

function secondsUntil(date: Date, now: Date = new Date()): number {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1000));
}

function mimeTypeFor(formato: string): string {
  if (formato === "csv") return "text/csv; charset=utf-8";
  if (formato === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (formato === "pdf") return "application/pdf";
  return "application/octet-stream";
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

  // Datos vía proxy interno a /api/informes. Cookies + host del request
  // original se propagan; withTenant resuelve el tenant de nuevo allí.
  const proxiedUrl = new URL(req.url);
  proxiedUrl.pathname = "/api/informes";
  proxiedUrl.searchParams.delete("formato");
  const proxied = await fetch(proxiedUrl, { headers: req.headers });
  if (!proxied.ok) {
    return NextResponse.json(
      { error: "informes_failed", status: proxied.status },
      { status: 500 },
    );
  }
  const payload = (await proxied.json()) as InformePayload;

  const fechaSlug = new Date().toISOString().slice(0, 10);
  const tipoSlug = String(payload.tipo ?? "informe").replace(/[^a-z0-9-]+/gi, "_");
  const filename = `${tipoSlug}_${fechaSlug}.${formato}`;

  if (formato === "csv") {
    const csv = generarCSV(payload);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": mimeTypeFor("csv"),
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
  if (formato === "xlsx") {
    const buf = generarExcel(payload);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mimeTypeFor("xlsx"),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
      },
    });
  }
  // pdf
  const buf = generarPDF(payload);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": mimeTypeFor("pdf"),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
    },
  });
});
