/**
 * handleSubscriptionPaused. ADR-003 §2.3.a.
 *
 * Stripe permite pausar una subscription sin cancelarla (uso típico:
 * test, soporte). Equivalente a una suspensión temporal — el tenant
 * pasa a SUSPENDED y deja de poder usar la app, pero la subscription
 * y los datos siguen.
 *
 * Para el flujo cliente final no se usa (Stripe portal de facturación
 * suele tener la pausa deshabilitada). Reservado para test/soporte.
 */

import type Stripe from "stripe";
import { prismaMaster } from "@/lib/prisma";

export async function handleSubscriptionPaused(
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
  if (!tenant) return;

  await prismaMaster.subscription.updateMany({
    where: { stripeSubscriptionId: subscription.id },
    data: { status: "paused" },
  });
  await prismaMaster.tenant.update({
    where: { id: tenant.id },
    data: { status: "suspended" },
  });
}
