import type Stripe from "stripe";
import { NotImplementedError } from "../dispatch";

/**
 * Stub. Se materializa en commit 10 (vaciar features, mantener manual_override).
 */
export async function handleSubscriptionDeleted(
  _event: Stripe.Event,
): Promise<void> {
  throw new NotImplementedError("customer.subscription.deleted", "10");
}
