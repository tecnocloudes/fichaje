import type Stripe from "stripe";
import { NotImplementedError } from "../dispatch";

/**
 * Stub. Se materializa en commit 6 (coreografía PENDING→PROVISIONING→ACTIVE).
 * ADR-003 §2.6.
 */
export async function handleCheckoutCompleted(
  _event: Stripe.Event,
): Promise<void> {
  throw new NotImplementedError("checkout.session.completed", "6");
}
