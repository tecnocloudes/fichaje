/**
 * Cliente Stripe singleton. ADR-003.
 *
 * - apiVersion fija para evitar drifts de Stripe automáticamente.
 * - Lazy: si STRIPE_SECRET_KEY no está, lanza al primer uso (igual
 *   patrón que prismaApp). Esto permite que el módulo sea importable
 *   en tests sin la variable.
 *
 * Las features de Fase 4 que usan este cliente:
 *  - /api/webhooks/stripe (verificación de firma + handlers).
 *  - server action de /registro (checkout.sessions.create).
 *  - /configuracion/facturacion (billingPortal.sessions.create).
 *  - scripts/stripe-bootstrap.ts (productos + prices upsert).
 */

import Stripe from "stripe";

let _stripe: Stripe | undefined;

function getStripeSecret(): string {
  const v = process.env.STRIPE_SECRET_KEY;
  if (!v || v.length === 0) {
    throw new Error(
      "Falta STRIPE_SECRET_KEY. En desarrollo, exporta sk_test_... antes de " +
        "ejecutar el comando.",
    );
  }
  return v;
}

/**
 * Cliente lazy: el primer acceso construye la instancia. En tests con
 * `vi.mock` esta función puede ser sustituida.
 */
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    if (!_stripe) {
      _stripe = new Stripe(getStripeSecret(), {
        // Pin de versión: actualizar manualmente con cada upgrade del SDK.
        // Stripe SDK v22 acepta string libre (typedef: apiVersion?: string).
        apiVersion: "2026-04-22.dahlia",
        typescript: true,
        appInfo: { name: "fichaje", version: "0.1.0" },
      });
    }
    const value = Reflect.get(_stripe, prop);
    return typeof value === "function" ? value.bind(_stripe) : value;
  },
});

/** Solo para tests. Limpia el singleton. */
export function _resetStripeForTest(): void {
  _stripe = undefined;
}
