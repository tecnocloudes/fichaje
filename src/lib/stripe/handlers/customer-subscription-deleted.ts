/**
 * handleSubscriptionDeleted — tenant.status = SUSPENDED + vaciar features
 * de plan/addon. ADR-003 §2.3.a.
 *
 * Disparado por:
 *  - Stripe tras finalizar dunning (14 días sin pagar).
 *  - El usuario al cancelar (con efecto al final del periodo en curso,
 *    dependiendo de configuración del Stripe portal).
 *
 * Lógica:
 *  1. Lookup tenant por stripe_customer_id.
 *  2. UPDATE master.subscriptions.status = 'canceled'.
 *  3. UPDATE master.tenants.status = 'suspended' (NO 'deleted' — la
 *     retención RD 8/2019 obliga a conservar datos. ADR-008 cierra el
 *     SUSPENDED → DELETED en su día).
 *  4. DELETE master.tenant_features WHERE source IN ('plan', 'addon').
 *     Las filas con source='manual_override' se preservan
 *     (administrador puede mantener acceso a features puntuales).
 */

import type Stripe from "stripe";
import { prismaMaster } from "@/lib/prisma";

export async function handleSubscriptionDeleted(
  event: Stripe.Event,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const tenant = await prismaMaster.tenant.findUnique({
    where: { stripeCustomerId: customerId },
  });
  if (!tenant) {
    console.warn(
      `[stripe] customer ${customerId} no mapea a tenant en deleted; ignorando`,
    );
    return;
  }

  // 1. Marcar subscription como canceled (idempotente).
  await prismaMaster.subscription.updateMany({
    where: { stripeSubscriptionId: subscription.id },
    data: { status: "canceled" },
  });

  // 2. Tenant a suspended (no deleted — retención RD 8/2019).
  await prismaMaster.tenant.update({
    where: { id: tenant.id },
    data: { status: "suspended" },
  });

  // 3. Vaciar features de plan/addon. Preservar manual_override.
  await prismaMaster.tenantFeature.deleteMany({
    where: {
      tenantId: tenant.id,
      source: { in: ["plan", "addon"] },
    },
  });
}
