import type Stripe from "stripe";
import { NotImplementedError } from "../dispatch";

/**
 * Stub. Se materializa en commit 9 (sync subscriptions + items + features).
 * ADR-003 §2.3.a.
 */
export async function handleSubscriptionUpdated(
  _event: Stripe.Event,
): Promise<void> {
  throw new NotImplementedError("customer.subscription.updated", "9");
}
