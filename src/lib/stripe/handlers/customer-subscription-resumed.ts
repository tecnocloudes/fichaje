/**
 * handleSubscriptionResumed. ADR-003 §2.3.a.
 *
 * Inverso de paused: subscription vuelve a active y el tenant también.
 */

import type Stripe from "stripe";
import { prismaMaster } from "@/lib/prisma";

export async function handleSubscriptionResumed(
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
    data: { status: subscription.status },
  });
  // Solo reactivar si estaba suspended por nosotros (no si estaba
  // suspended por dunning — eso lo gestiona payment_succeeded).
  if (tenant.status === "suspended") {
    await prismaMaster.tenant.update({
      where: { id: tenant.id },
      data: { status: "active" },
    });
  }
}
