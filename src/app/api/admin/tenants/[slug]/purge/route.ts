/**
 * POST /api/admin/tenants/[slug]/purge
 * Plan Fase 7 §4.4 + ADR-008.
 *
 * mode='pseudonymize' o 'hard-delete'. Solo cuando status=deleted.
 * Requiere confirmación del slug en body.confirmSlug (typo literal).
 *
 * NOTA: la lógica real de purge la ejecuta el CLI tenants-purge (ADR-008).
 * Este endpoint es un wrapper que permite invocarlo desde el panel.
 * Para Fase 7 stub: marca un flag en BD + audita; CLI sigue siendo
 * la fuente de verdad. Refactor completo Fase 9 cuando ADR-008 lo cierre.
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
  const body = (await req.json()) as {
    mode?: "pseudonymize" | "hard-delete";
    confirmSlug?: string;
  };
  if (body.confirmSlug !== slug) {
    return NextResponse.json(
      { error: "confirmation_mismatch", reason: "Tipea el slug exacto en confirmSlug" },
      { status: 400 },
    );
  }
  if (body.mode !== "pseudonymize" && body.mode !== "hard-delete") {
    return NextResponse.json(
      { error: "invalid_mode", allowed: ["pseudonymize", "hard-delete"] },
      { status: 400 },
    );
  }
  const meta = extractRequestMeta(req.headers);
  const tenant = await prismaMaster.tenant.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  if (tenant.status !== "deleted") {
    return NextResponse.json(
      {
        error: "tenant_not_deleted",
        reason: "Solo tenants en status='deleted' pueden purgarse",
      },
      { status: 409 },
    );
  }

  // Stub Fase 7: registra la solicitud en audit_log, devuelve mensaje
  // que indica al super-admin ejecutar el CLI. Implementación completa
  // del lifecycle ADR-008 sigue en CLI hasta Fase 9.
  const action =
    body.mode === "pseudonymize"
      ? "tenants:purge:pseudonymize"
      : "tenants:purge:hard-delete";

  await writeAuditEntry({
    superAdminId: sa.id,
    action,
    targetKind: "tenant",
    targetId: tenant.id,
    summary: { slug, mode: body.mode, executed: false },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({
    accepted: true,
    note: `Ejecuta 'npm run tenants:purge -- ${slug} --${body.mode}' en el servidor para completar. Auditada la intención.`,
  });
});
