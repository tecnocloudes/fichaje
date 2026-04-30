/**
 * /admin/configuracion/facturacion — Stripe Billing Portal redirect.
 *
 * Solo OWNER. Vive en el subdominio del tenant (proxy.ts kind=tenant).
 * Aplica withTenant indirectamente porque está bajo /admin (que el
 * proxy ya gating por rol).
 *
 * Lookup de stripeCustomerId vía prismaMaster.tenant (necesita acceso
 * a master.tenants). Crea Stripe Billing Portal session y redirige.
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prismaMaster } from "@/lib/prisma";
import { stripe } from "@/lib/stripe/client";
import { currentTenant } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const rol = (session.user as { rol?: string }).rol;
  if (rol !== "OWNER") {
    return (
      <main style={{ padding: 32, textAlign: "center" }}>
        <h1>Acceso denegado</h1>
        <p>Solo el OWNER puede gestionar la facturación.</p>
      </main>
    );
  }

  const ctx = currentTenant();
  const tenant = await prismaMaster.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { stripeCustomerId: true, slug: true },
  });

  if (!tenant?.stripeCustomerId) {
    return (
      <main style={{ padding: 32, textAlign: "center" }}>
        <h1>Cuenta sin Stripe</h1>
        <p>
          Esta cuenta no está vinculada a un Customer de Stripe (típicamente
          tenants provisionados manualmente sin checkout). Contacta soporte si
          esto es un error.
        </p>
      </main>
    );
  }

  const root = process.env.TENANT_ROOT_DOMAIN ?? "ficha.tecnocloud.es";
  const proto = root === "localhost" ? "http" : "https";
  const port = root === "localhost" ? ":3000" : "";
  const returnUrl = `${proto}://${tenant.slug}.${root}${port}/admin/configuracion`;

  const portal = await stripe.billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: returnUrl,
  });
  redirect(portal.url);
}
