/**
 * /api/healthz — endpoint de healthcheck para Dokploy / Docker / k8s.
 *
 * Devuelve:
 *   - 200 + { status: "ok", db: "connected", version }     si master DB responde
 *   - 503 + { status: "error", reason, version }           si falla
 *
 * Verifica master.tenants con un SELECT 1 ligero (sin tocar datos del
 * tenant) usando `prismaMaster`. NO usa `withTenant` — este endpoint
 * sirve para el host del balanceador / probe interno y no tiene
 * tenant en contexto (ADR-002 §3.5: paths exentos).
 *
 * Whitelist en `proxy.ts`: el path /api/healthz está bajo /api/ que
 * ya pasa sin autenticación (`isApiRoute = true → NextResponse.next()`).
 */

import { prismaMaster } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = process.env.GIT_SHA ?? process.env.NEXT_PUBLIC_GIT_SHA ?? "dev";

export async function GET() {
  try {
    // Query mínimo: SELECT 1. No depende de ninguna tabla. Si la
    // conexión está rota, lanza inmediatamente.
    await prismaMaster.$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok", db: "connected", version: VERSION },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "unknown database error";
    return Response.json(
      { status: "error", reason, version: VERSION },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
