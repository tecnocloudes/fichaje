/**
 * POST /api/marketplace/google/sync-users — sincroniza empleados desde
 * Google Workspace Directory API. Solo OWNER. Feature `marketplace`.
 *
 * Requiere que la integración `google_workspace` esté instalada con
 * accessToken válido. Devuelve un report con creados/actualizados.
 */

import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { syncEmpleadosFromGoogle } from "@/lib/marketplace/google-workspace";

export const POST = withTenant(
  withFeature("marketplace", async () => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
    }

    try {
      const report = await syncEmpleadosFromGoogle();
      return NextResponse.json({ ok: true, report });
    } catch (err) {
      return NextResponse.json(
        { error: "sync_failed", reason: (err as Error).message },
        { status: 400 },
      );
    }
  }),
);
