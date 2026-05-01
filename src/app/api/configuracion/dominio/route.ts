/**
 * GET/POST/DELETE /api/configuracion/dominio
 * Plan Fase 6 §4.5.
 *
 * Gestiona el dominio personalizado del tenant. Feature-gated por
 * `dominio_personalizado` (addon). Solo OWNER del tenant.
 *
 * Flow:
 *  - GET: devuelve estado actual (dominio, verificado, token DNS).
 *  - POST: registra/regenera dominio + token. customDomainVerified
 *          se resetea a false (el OWNER tiene que verificar de nuevo).
 *  - DELETE: elimina dominio del tenant.
 *
 * Verificación TXT: endpoint aparte (verify/route.ts).
 *
 * Importante: el endpoint vive en subdominio del tenant, así que usa
 * `currentTenant().tenantId` para identificar al tenant. Modifica
 * `master.tenants` con `prismaMaster` (whitelist explícita —
 * /api/configuracion no usa /api/onboarding/status del subdominio app).
 */

import { auth } from "@/lib/auth";
import { prismaMaster } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextResponse, type NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { currentTenant } from "@/lib/tenant/context";
import { invalidateTenantHostCache } from "@/lib/tenant/cache";
import { randomUUID } from "node:crypto";

const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export const GET = withTenant(
  withFeature("dominio_personalizado", async () => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const { tenantId } = currentTenant();
    const tenant = await prismaMaster.tenant.findUnique({
      where: { id: tenantId },
      select: {
        customDomain: true,
        customDomainVerified: true,
        customDomainToken: true,
      },
    });
    if (!tenant) {
      return NextResponse.json({ error: "tenant no encontrado" }, { status: 404 });
    }
    return NextResponse.json({
      domain: tenant.customDomain,
      verified: tenant.customDomainVerified,
      // El token solo se devuelve si hay dominio registrado.
      verifyRecord: tenant.customDomain
        ? {
            host: `_fichaje-verify.${tenant.customDomain}`,
            type: "TXT",
            value: `fichaje-verify=${tenant.customDomainToken ?? ""}`,
          }
        : null,
    });
  }),
);

export const POST = withTenant(
  withFeature("dominio_personalizado", async (req: NextRequest) => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const body = (await req.json()) as { domain?: string };
    const domain = body.domain?.trim().toLowerCase();
    if (!domain || !DOMAIN_RE.test(domain) || domain.length > 253) {
      return NextResponse.json(
        { error: "domain_invalid", reason: "FQDN inválido" },
        { status: 400 },
      );
    }
    const { tenantId } = currentTenant();
    const token = randomUUID();
    try {
      const updated = await prismaMaster.tenant.update({
        where: { id: tenantId },
        data: {
          customDomain: domain,
          customDomainToken: token,
          customDomainVerified: false,
        },
        select: { customDomain: true, customDomainToken: true },
      });
      // Invalidar caché del host viejo (si lo había) y nuevo (por si
      // alguna request anterior lo había cacheado como invalid).
      invalidateTenantHostCache(domain);
      return NextResponse.json({
        domain: updated.customDomain,
        verified: false,
        verifyRecord: {
          host: `_fichaje-verify.${updated.customDomain}`,
          type: "TXT",
          value: `fichaje-verify=${updated.customDomainToken}`,
        },
      });
    } catch (err: unknown) {
      // Conflict UNIQUE: dominio ya en uso.
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        return NextResponse.json(
          { error: "domain_already_in_use" },
          { status: 409 },
        );
      }
      throw err;
    }
  }),
);

export const DELETE = withTenant(
  withFeature("dominio_personalizado", async () => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const { tenantId } = currentTenant();
    const before = await prismaMaster.tenant.findUnique({
      where: { id: tenantId },
      select: { customDomain: true },
    });
    await prismaMaster.tenant.update({
      where: { id: tenantId },
      data: {
        customDomain: null,
        customDomainToken: null,
        customDomainVerified: false,
      },
    });
    if (before?.customDomain) {
      invalidateTenantHostCache(before.customDomain);
    }
    return NextResponse.json({ success: true });
  }),
);
