/**
 * Dispatch de eventos Stripe a handlers concretos. ADR-003 §2.3.a.
 *
 * Lista blanca: solo los 9 eventos enumerados disparan side-effects.
 * Cualquier otro tipo se ignora silenciosamente (default branch
 * devuelve sin hacer nada). El registro en `master.stripe_events` lo
 * hace `recordEventOrSkip` antes de llamar aquí.
 *
 * Cada handler vive en `./handlers/<evento>.ts` y se materializa en
 * commits siguientes:
 *   - commit 6: handleCheckoutCompleted (coreografía completa).
 *   - commit 7: handleSubscriptionUpdated.
 *   - commit 9: handleSubscriptionUpdated (plan/addons resync).
 *   - commit 10: handleSubscriptionDeleted.
 *   - commit 11: handlePaymentSucceeded + handlePaymentFailed.
 *   - commit 12: handleSubscriptionPaused/Resumed/TrialWillEnd/CheckoutExpired.
 *
 * Hasta que cada handler exista, el stub correspondiente lanza
 * `NotImplementedError` con el commit donde se materializa. Esto hace
 * el progreso explícito en logs y evita silencios.
 */

import type Stripe from "stripe";
import { handleCheckoutCompleted } from "./handlers/checkout-session-completed";
import { handleSubscriptionUpdated } from "./handlers/customer-subscription-updated";
import { handleSubscriptionDeleted } from "./handlers/customer-subscription-deleted";
import { handleSubscriptionPaused } from "./handlers/customer-subscription-paused";
import { handleSubscriptionResumed } from "./handlers/customer-subscription-resumed";
import { handleTrialWillEnd } from "./handlers/customer-subscription-trial-will-end";
import { handlePaymentSucceeded } from "./handlers/invoice-payment-succeeded";
import { handlePaymentFailed } from "./handlers/invoice-payment-failed";
import { handleCheckoutExpired } from "./handlers/checkout-session-expired";

export class NotImplementedError extends Error {
  constructor(handler: string, commit: string) {
    super(`Handler ${handler} pendiente de commit ${commit} (Fase 4).`);
    this.name = "NotImplementedError";
  }
}

export async function dispatchEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(event);
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(event);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event);
    case "customer.subscription.paused":
      return handleSubscriptionPaused(event);
    case "customer.subscription.resumed":
      return handleSubscriptionResumed(event);
    case "customer.subscription.trial_will_end":
      return handleTrialWillEnd(event);
    case "invoice.payment_succeeded":
      return handlePaymentSucceeded(event);
    case "invoice.payment_failed":
      return handlePaymentFailed(event);
    case "checkout.session.expired":
      return handleCheckoutExpired(event);
    default:
      // §2.3.b: ignorado intencional. processed_at queda NULL para
      // distinguir "nunca procesado" de "procesado".
      return;
  }
}
