import type Stripe from "stripe";
import { NotImplementedError } from "../dispatch";

/**
 * Stub. Se materializa en commit 12.
 */
export async function handleCheckoutExpired(
  _event: Stripe.Event,
): Promise<void> {
  throw new NotImplementedError("checkout.session.expired", "12");
}
