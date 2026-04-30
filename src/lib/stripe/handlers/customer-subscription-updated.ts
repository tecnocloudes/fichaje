/**
 * handleSubscriptionUpdated — sync subscriptions + items + features.
 * ADR-003 §2.3.a.
 *
 * Disparado por:
 *  - El propio Stripe tras un `customer.subscription.updated` (cambio
 *    de plan, addon añadido/quitado, cancel_at_period_end, etc.).
 *  - El billing portal de §6 cuando el OWNER cambia algo.
 *
 * Lógica:
 *  1. Lookup tenant por subscription.customer (stripe_customer_id).
 *  2. persistSubscription (upsert + items).
 *  3. recomposeTenantFeatures (recalcular plan + addons; preservar
 *     manual_override).
 *
 * No transiciona el status del tenant — eso lo hace
 * customer.subscription.deleted o invoice.payment_failed.
 */

import type Stripe from "stripe";
import { prismaMaster } from "@/lib/prisma";
import {
  persistSubscription,
  recomposeTenantFeatures,
} from "../feature-resolver";

export async function handleSubscriptionUpdated(
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
      `[stripe] customer ${customerId} no mapea a un tenant; ignorando`,
    );
    return;
  }

  await persistSubscription(tenant.id, subscription);
  await recomposeTenantFeatures(tenant.id, subscription);
}
