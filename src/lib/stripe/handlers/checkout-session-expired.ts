/**
 * handleCheckoutExpired. ADR-003 §2.3.a + §2.6.
 *
 * Stripe emite este evento cuando una checkout.session expira (24h sin
 * completar). Solo lo registramos en master.stripe_events (que ya hizo
 * el caller). El cleanup del tenant PENDING lo hace el job horario
 * (commit 19) — aquí NO borramos el tenant para no duplicar lógica.
 */

import type Stripe from "stripe";

export async function handleCheckoutExpired(
  _event: Stripe.Event,
): Promise<void> {
  // No-op intencional. El job de §5.1 limpia los tenants PENDING > 24h.
  return;
}
