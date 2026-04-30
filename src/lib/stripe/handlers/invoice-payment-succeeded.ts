/**
 * handlePaymentSucceeded. ADR-003 §2.3.a.
 *
 * Disparado por Stripe `invoice.payment_succeeded`. Caso típico:
 *  - Pago mensual/anual recurrente exitoso → no hace falta más que
 *    actualizar la subscription (Stripe ya emite
 *    `customer.subscription.updated` también).
 *  - Recuperación tras dunning: si la subscription estaba `past_due`,
 *    pasa a `active` automáticamente. Aquí re-activamos el tenant si
 *    estaba suspendido por dunning.
 */

import type Stripe from "stripe";
import { prismaMaster } from "@/lib/prisma";

export async function handlePaymentSucceeded(
  event: Stripe.Event,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  if (!invoice.subscription) return; // factura sin sub (one-off, no aplica).

  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription.id;
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : (invoice.customer?.id ?? null);
  if (!customerId) return;

  const tenant = await prismaMaster.tenant.findUnique({
    where: { stripeCustomerId: customerId },
  });
  if (!tenant) return;

  const sub = await prismaMaster.subscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
  });
  if (!sub) return;

  // Si estaba en past_due o paused y vuelve a active, reactivar tenant.
  // (El propio webhook customer.subscription.updated también recompone
  // el status, pero esto es defensa en profundidad.)
  if (
    (sub.status === "past_due" || sub.status === "paused") &&
    tenant.status === "suspended"
  ) {
    await prismaMaster.tenant.update({
      where: { id: tenant.id },
      data: { status: "active" },
    });
  }
}
