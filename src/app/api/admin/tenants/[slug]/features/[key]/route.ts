/**
 * DELETE /api/admin/tenants/[slug]/features/[key]
 * Plan Fase 7 §4.3 — quitar override manual (vuelve a heredar plan/addon).
 */

import { type NextRequest, NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

export const DELETE = withSuperAdmin(async (
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; key: string }> },
) => {
  const sa = currentSuperAdmin();
  if (sa.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { slug, key } = await params;
  const tenant = await prismaMaster.tenant.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  const meta = extractRequestMeta(req.headers);
  try {
    await prismaMaster.tenantFeature.delete({
      where: {
        tenantId_featureKey_source: {
          tenantId: tenant.id,
          featureKey: key,
          source: "manual_override",
        },
      },
    });
  } catch {
    return NextResponse.json(
      { error: "override_not_found" },
      { status: 404 },
    );
  }
  await writeAuditEntry({
    superAdminId: sa.id,
    action: "tenant_features:override:remove",
    targetKind: "feature",
    targetId: `${slug}:${key}`,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return NextResponse.json({ success: true });
});
