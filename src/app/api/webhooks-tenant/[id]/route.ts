/**
 * DELETE /api/webhooks-tenant/[id] — soft-delete del webhook.
 */

import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const DELETE = withTenant(
  withFeature("webhooks", async (
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user || user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const { id } = await params;
    try {
      await prismaApp.tenantWebhook.update({
        where: { id },
        data: { active: false },
      });
    } catch {
      return NextResponse.json(
        { error: "webhook_not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true });
  }),
);
