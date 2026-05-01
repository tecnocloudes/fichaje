/**
 * GET /api/admin/tenants — listado de tenants con filtros.
 * Plan Fase 7 §4.1.
 */

import { NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

export const GET = withSuperAdmin(async (req) => {
  const sa = currentSuperAdmin();
  const meta = extractRequestMeta(req.headers);
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const q = searchParams.get("q");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const offset = Number(searchParams.get("offset") ?? 0);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { slug: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prismaMaster.tenant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        slug: true,
        name: true,
        email: true,
        status: true,
        customDomain: true,
        customDomainVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prismaMaster.tenant.count({ where }),
  ]);

  await writeAuditEntry({
    superAdminId: sa.id,
    action: "tenants:list",
    targetKind: "tenant",
    targetId: "*",
    summary: { count: items.length, total, filters: { status, q } },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ items, total, limit, offset });
});
