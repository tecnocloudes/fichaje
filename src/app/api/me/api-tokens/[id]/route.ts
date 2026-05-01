/**
 * DELETE /api/me/api-tokens/[id] — revoca token (set revokedAt).
 * Plan D.1.
 *
 * Soft-delete (revokedAt timestamp) en vez de DELETE para preservar
 * audit trail.
 */

import { auth } from "@/lib/auth";
import { prismaMaster } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { currentTenant } from "@/lib/tenant/context";

export const DELETE = withTenant(
  withFeature("api_access", async (
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user || user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const { id } = await params;
    const { tenantId } = currentTenant();
    // Solo el dueño del tenant puede revocar; la condición incluye
    // tenantId para evitar cross-tenant.
    const result = await prismaMaster.apiToken.updateMany({
      where: { id, tenantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      return NextResponse.json(
        { error: "token_not_found_or_revoked" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true });
  }),
);
