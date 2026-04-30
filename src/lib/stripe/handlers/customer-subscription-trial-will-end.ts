import type Stripe from "stripe";
import { NotImplementedError } from "../dispatch";

/**
 * Stub. Se materializa en commit 12.
 */
export async function handleTrialWillEnd(
  _event: Stripe.Event,
): Promise<void> {
  throw new NotImplementedError("customer.subscription.trial_will_end", "12");
}
