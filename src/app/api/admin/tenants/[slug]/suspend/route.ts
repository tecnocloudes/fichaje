/**
 * POST /api/admin/tenants/[slug]/suspend
 * Plan Fase 7 §4.4. active → suspended.
 */

import { type NextRequest, NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

export const POST = withSuperAdmin(async (
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) => {
  const sa = currentSuperAdmin();
  if (sa.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { slug } = await params;
  const meta = extractRequestMeta(req.headers);
  const tenant = await prismaMaster.tenant.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  if (tenant.status !== "active") {
    return NextResponse.json(
      { error: "invalid_transition", from: tenant.status, to: "suspended" },
      { status: 409 },
    );
  }
  await prismaMaster.tenant.update({
    where: { id: tenant.id },
    data: { status: "suspended" },
  });
  await writeAuditEntry({
    superAdminId: sa.id,
    action: "tenants:suspend",
    targetKind: "tenant",
    targetId: tenant.id,
    summary: { slug },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return NextResponse.json({ success: true, status: "suspended" });
});
