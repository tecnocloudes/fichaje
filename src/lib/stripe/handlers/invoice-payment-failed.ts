import type Stripe from "stripe";
import { NotImplementedError } from "../dispatch";

/**
 * Stub. Se materializa en commit 11.
 */
export async function handlePaymentFailed(
  _event: Stripe.Event,
): Promise<void> {
  throw new NotImplementedError("invoice.payment_failed", "11");
}
