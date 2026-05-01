/**
 * POST /api/configuracion/dominio/verify
 * Plan Fase 6 §4.2 + §4.5.
 *
 * Verifica el TXT record `_fichaje-verify.<dominio>` contiene
 * `fichaje-verify=<token>` y, si coincide, marca el dominio como
 * verified=true.
 *
 * Timeout DNS: 5s. Si DNS no responde o no encuentra el TXT, devuelve
 * 400 con detalle (UI muestra "puede tardar 24h en propagar").
 */

import { auth } from "@/lib/auth";
import { prismaMaster } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { currentTenant } from "@/lib/tenant/context";
import { invalidateTenantHostCache } from "@/lib/tenant/cache";
import { resolveTxtWithTimeout } from "@/lib/tenant/dns";

export const POST = withTenant(
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
      select: { customDomain: true, customDomainToken: true },
    });
    if (!tenant?.customDomain || !tenant.customDomainToken) {
      return NextResponse.json(
        { error: "domain_not_registered", reason: "Registra un dominio primero (POST)." },
        { status: 400 },
      );
    }

    const txtHost = `_fichaje-verify.${tenant.customDomain}`;
    const expected = `fichaje-verify=${tenant.customDomainToken}`;
    let records: string[][];
    try {
      records = await resolveTxtWithTimeout(txtHost, 5000);
    } catch (err: unknown) {
      const reason =
        err instanceof Error ? err.message : "DNS lookup failed";
      return NextResponse.json(
        { error: "dns_lookup_failed", reason },
        { status: 400 },
      );
    }
    // resolveTxt devuelve string[][] (cada registro como array de chunks).
    const flat = records.map((r) => r.join(""));
    if (!flat.includes(expected)) {
      return NextResponse.json(
        {
          error: "txt_record_not_found",
          expected,
          found: flat,
          hint: "El cambio DNS puede tardar hasta 24h en propagar.",
        },
        { status: 400 },
      );
    }

    await prismaMaster.tenant.update({
      where: { id: tenantId },
      data: { customDomainVerified: true },
    });
    invalidateTenantHostCache(tenant.customDomain);

    return NextResponse.json({
      domain: tenant.customDomain,
      verified: true,
    });
  }),
);
