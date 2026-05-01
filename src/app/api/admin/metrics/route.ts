/**
 * GET /api/admin/metrics — métricas globales del SaaS.
 * Plan Fase 7 §4.6.
 *
 * Tres bloques:
 *  - Tenants: count por status, total, registros últimos 30d.
 *  - Subscriptions: count por status, MRR estimado (suma de prices).
 *  - Audit: count por severity últimas 24h.
 */

import { NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

export const GET = withSuperAdmin(async (req) => {
  const sa = currentSuperAdmin();
  const meta = extractRequestMeta(req.headers);

  const now = new Date();
  const hace30dias = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const hace24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [tenantsByStatus, registros30d, subsByStatus, auditBySeverity] =
    await Promise.all([
      prismaMaster.tenant.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prismaMaster.tenant.count({
        where: { createdAt: { gte: hace30dias } },
      }),
      prismaMaster.subscription.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prismaMaster.auditLog.groupBy({
        by: ["severity"],
        where: { createdAt: { gte: hace24h } },
        _count: { _all: true },
      }),
    ]);

  // MRR estimado: count de subscriptions activas (no consideramos
  // precio real Stripe — Fase 9 puede traerlo de `master.subscription`).
  // Por ahora devuelve null para ser explícito sobre que no es real.
  const totalActive =
    subsByStatus.find((s) => s.status === "active")?._count._all ?? 0;

  await writeAuditEntry({
    superAdminId: sa.id,
    action: "metrics:read",
    targetKind: "metrics",
    targetId: "global",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({
    tenants: {
      byStatus: Object.fromEntries(
        tenantsByStatus.map((t) => [t.status, t._count._all]),
      ),
      total: tenantsByStatus.reduce((acc, t) => acc + t._count._all, 0),
      registros30d,
    },
    subscriptions: {
      byStatus: Object.fromEntries(
        subsByStatus.map((s) => [s.status, s._count._all]),
      ),
      activeCount: totalActive,
      mrrEur: null, // Fase 9: importar de Stripe price.
    },
    audit24h: {
      bySeverity: Object.fromEntries(
        auditBySeverity.map((a) => [a.severity, a._count._all]),
      ),
    },
  });
});
