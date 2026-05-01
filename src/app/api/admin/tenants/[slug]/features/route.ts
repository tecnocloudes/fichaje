/**
 * POST /api/admin/tenants/[slug]/features
 * Plan Fase 7 §4.3 + ADR-007 §2.7 (action='tenant_features:override').
 *
 * Crea/reemplaza un override manual en master.tenant_features con
 * source='manual_override'. `reason` obligatorio (length≥10).
 *
 * Solo SUPER_ADMIN (no SUPPORT). El SUPPORT solo puede leer.
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
    return NextResponse.json(
      { error: "forbidden", reason: "Solo SUPER_ADMIN puede modificar features" },
      { status: 403 },
    );
  }
  const { slug } = await params;
  const body = (await req.json()) as {
    featureKey?: string;
    value?: unknown;
    expiresAt?: string | null;
    reason?: string;
  };
  if (!body.featureKey || body.value === undefined || !body.reason) {
    return NextResponse.json(
      { error: "missing_fields", required: ["featureKey", "value", "reason"] },
      { status: 400 },
    );
  }
  if (body.reason.length < 10) {
    return NextResponse.json(
      { error: "reason_too_short", min: 10 },
      { status: 400 },
    );
  }

  const tenant = await prismaMaster.tenant.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  const meta = extractRequestMeta(req.headers);
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

  const tf = await prismaMaster.tenantFeature.upsert({
    where: {
      tenantId_featureKey_source: {
        tenantId: tenant.id,
        featureKey: body.featureKey,
        source: "manual_override",
      },
    },
    create: {
      tenantId: tenant.id,
      featureKey: body.featureKey,
      value: body.value as never,
      source: "manual_override",
      expiresAt,
      reason: body.reason,
    },
    update: {
      value: body.value as never,
      expiresAt,
      reason: body.reason,
    },
  });

  await writeAuditEntry({
    superAdminId: sa.id,
    action: "tenant_features:override",
    targetKind: "feature",
    targetId: `${slug}:${body.featureKey}`,
    summary: { value: body.value, expiresAt: expiresAt?.toISOString(), reason: body.reason },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ override: tf });
});
