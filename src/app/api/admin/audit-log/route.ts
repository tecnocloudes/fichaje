/**
 * GET /api/admin/audit-log
 * Plan Fase 7 §4.5 + ADR-007 §2.5 (visibilidad por rol).
 *
 * Filtros: action, target_kind, target_id, severity, super_admin_id,
 *          fechaDesde, fechaHasta. Paginación.
 *
 * Visibilidad:
 *  - SUPER_ADMIN: todas las entradas (info + warning + critical).
 *  - SUPPORT: info de cualquiera + warning/critical solo suyas.
 */

import { NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";

export const GET = withSuperAdmin(async (req) => {
  const sa = currentSuperAdmin();
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const targetKind = searchParams.get("target_kind");
  const targetId = searchParams.get("target_id");
  const severity = searchParams.get("severity");
  const superAdminId = searchParams.get("super_admin_id");
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const offset = Number(searchParams.get("offset") ?? 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (action) where.action = action;
  if (targetKind) where.targetKind = targetKind;
  if (targetId) where.targetId = targetId;
  if (severity) where.severity = severity;
  if (superAdminId) where.superAdminId = superAdminId;
  if (desde || hasta) {
    where.createdAt = {};
    if (desde) where.createdAt.gte = new Date(desde);
    if (hasta) where.createdAt.lte = new Date(hasta);
  }

  // Visibilidad por rol: SUPPORT solo ve info global + sus warnings/critical.
  if (sa.role === "SUPPORT") {
    where.OR = [{ severity: "info" }, { superAdminId: sa.id }];
  }

  const [items, total] = await Promise.all([
    prismaMaster.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        superAdmin: { select: { email: true, name: true } },
      },
    }),
    prismaMaster.auditLog.count({ where }),
  ]);

  // No auto-auditar lecturas del audit-log (para evitar recursión y
  // ruido). ADR-007 §4.5 nota.
  return NextResponse.json({ items, total, limit, offset });
});
