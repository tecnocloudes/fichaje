/**
 * GET /api/configuracion/auditoria — auditoría avanzada del tenant.
 * Plan D.6.
 *
 * Reusa master.audit_log (Fase 7) filtrado por target_id que matche
 * el tenant_id o slug del tenant actual. Solo OWNER.
 *
 * Features `auditoria_avanzada` controla acceso. Sin ella → 402.
 */

import { auth } from "@/lib/auth";
import { prismaMaster } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { currentTenant } from "@/lib/tenant/context";

export const GET = withTenant(
  withFeature("auditoria_avanzada", async (req) => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user || user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const { tenantId, slug } = currentTenant();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const offset = Number(searchParams.get("offset") ?? 0);
    // El audit_log master usa target_id = tenant.id O `${slug}:feature`.
    const items = await prismaMaster.auditLog.findMany({
      where: {
        OR: [
          { targetId: tenantId },
          { targetId: { startsWith: `${slug}:` } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        action: true,
        targetKind: true,
        targetId: true,
        severity: true,
        summary: true,
        createdAt: true,
        // No exponemos super_admin email/name al tenant — solo la
        // acción técnica. Privacidad operacional.
      },
    });
    return NextResponse.json({ items, limit, offset });
  }),
);
