/**
 * GET/POST /api/me/api-tokens — gestión de API tokens del tenant.
 * Plan D.1.
 *
 * GET: lista tokens (solo metadata: name, prefix, created/expires/lastUsed).
 *      Token plain NO se devuelve nunca tras el POST inicial.
 * POST: crea token + devuelve {plain} solo en esta respuesta. Avisar
 *       al cliente que lo guarde — no se podrá recuperar.
 *
 * Solo OWNER. Feature gate api_access.
 */

import { auth } from "@/lib/auth";
import { prismaMaster } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { currentTenant } from "@/lib/tenant/context";
import { generateToken, hashSecret } from "@/lib/api-v1/auth";

export const GET = withTenant(
  withFeature("api_access", async () => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user || user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const { tenantId } = currentTenant();
    const tokens = await prismaMaster.apiToken.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ tokens });
  }),
);

export const POST = withTenant(
  withFeature("api_access", async (req: NextRequest) => {
    const session = await auth();
    const user = session?.user as { rol?: string; id?: string } | undefined;
    if (!user || user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const body = (await req.json()) as { name?: string; expiresAt?: string | null };
    if (!body.name) {
      return NextResponse.json({ error: "name_required" }, { status: 400 });
    }
    const { tenantId } = currentTenant();
    const { plain, prefix, secret } = generateToken();
    const tokenHash = await hashSecret(secret);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    const created = await prismaMaster.apiToken.create({
      data: {
        tenantId,
        name: body.name,
        prefix,
        tokenHash,
        expiresAt,
        createdById: user.id ?? null,
      },
      select: { id: true, name: true, prefix: true, expiresAt: true, createdAt: true },
    });
    // El plain SOLO se devuelve aquí.
    return NextResponse.json({ ...created, plainToken: plain }, { status: 201 });
  }),
);
