/**
 * POST /api/cron/purge-biometrics
 *
 * Borra `Fichaje.fotoSnapshotEnc` (snapshot biométrico) cuyo `timestamp`
 * sea más antiguo que `ConfiguracionEmpresa.retencionFotosDias` (defecto
 * 90). Aplica a TODOS los tenants activos. RGPD art. 5.1.e (minimización).
 *
 * Autenticación: header `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Idempotente — re-ejecutarlo no rompe nada.
 *
 * No usa `withTenant` porque es operación de plataforma (sin host de
 * tenant). En su lugar itera tenants vía `prismaMaster` y reanida
 * `runWithTenant` para cada uno (mismo patrón que worker en email/push).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prismaMaster, prismaApp } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const tenants = await prismaMaster.tenant.findMany({
    where: { status: "active" },
    select: { id: true, slug: true },
  });

  type Result = { slug: string; purged: number; retencionDias: number; error?: string };
  const results: Result[] = [];

  for (const t of tenants) {
    try {
      const purged = await runWithTenant(
        { tenantId: t.id, slug: t.slug, status: "active", features: new Map() },
        async () => {

          const cfg = await prismaApp.configuracionEmpresa.findFirst({
            select: { retencionFotosDias: true },
          });
          const retDays = cfg?.retencionFotosDias ?? 90;
          const cutoff = new Date(Date.now() - retDays * 86_400_000);

          const r = await prismaApp.fichaje.updateMany({
            where: {
              timestamp: { lt: cutoff },
              fotoSnapshotEnc: { not: null },
            },
            data: { fotoSnapshotEnc: null },
          });

          return { count: r.count, retDays };
        },
      );
      results.push({ slug: t.slug, purged: purged.count, retencionDias: purged.retDays });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/purge-biometrics] tenant=${t.slug} error:`, msg);
      results.push({ slug: t.slug, purged: 0, retencionDias: 0, error: msg });
    }
  }

  const total = results.reduce((acc, r) => acc + r.purged, 0);
  return NextResponse.json({ ok: true, tenantsProcesados: results.length, totalPurgado: total, results });
}
