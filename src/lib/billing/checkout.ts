/**
 * Helpers para iniciar Stripe Checkout sessions desde la app del tenant.
 *
 * Modelo per-seat con mínimo de 15 usuarios global (Sesame-like):
 *   Stripe NO soporta nativamente "max(quantity × unit, mínimo)".
 *   El backend calcula `quantity = max(empleadosActivos, 15)` y se la
 *   pasa al line_item del Checkout. La factura muestra "N usuarios × X €".
 *
 *   Ejemplo Starter (4 €/usuario, mínimo 15):
 *     - 3 empleados → quantity=15 → 60 €/mes
 *     - 14 empleados → quantity=15 → 60 €/mes
 *     - 20 empleados → quantity=20 → 80 €/mes
 *
 *   El mínimo de 15 usuarios aplica a TODOS los planes:
 *     Starter mín    = 60 €/mes  (15 × 4)
 *     Pro mín        = 75 €/mes  (15 × 5)
 *     Enterprise mín = 90 €/mes  (15 × 6)
 *
 *   La UI muestra claramente "Importe mínimo X €/mes — 15 usuarios mínimo"
 *   en cada card y un banner global encima de la pricing-grid.
 */

import { PLAN_PRICING, type PlanKey } from "@/lib/billing/plan-pricing";
import { prismaMaster } from "@/lib/prisma";
import { stripe } from "@/lib/stripe/client";
import { getPlanPriceId } from "@/lib/stripe/price-catalog";

/**
 * Calcula la quantity a pasar al line_item de Stripe Checkout.
 * Devuelve `max(empleadosActivos, ceil(minimum / pricePerEmployee))`.
 */
export function calculateQuantity(empleadosActivos: number, plan: PlanKey): number {
  const p = PLAN_PRICING[plan];
  const minSeats = Math.ceil(p.monthlyMinimumCents / p.pricePerEmployeeCents);
  return Math.max(Math.max(0, empleadosActivos), minSeats);
}

/**
 * Devuelve el `stripeCustomerId` del tenant. Si no existe, crea uno
 * en Stripe y lo persiste en `master.tenants.stripeCustomerId`.
 */
export async function getOrCreateStripeCustomer(
  tenantId: string,
): Promise<string> {
  const tenant = await prismaMaster.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      slug: true,
      name: true,
      email: true,
      stripeCustomerId: true,
    },
  });
  if (!tenant) throw new Error(`Tenant ${tenantId} no existe`);
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: tenant.email,
    name: tenant.name,
    metadata: {
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
    },
  });

  await prismaMaster.tenant.update({
    where: { id: tenant.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

/**
 * Devuelve la URL base del subdominio del tenant (`https://<slug>.<root>`).
 * En desarrollo (`TENANT_ROOT_DOMAIN=localhost` o ausente) usa `http://`
 * y mantiene el puerto 3000.
 */
export function tenantBaseUrl(slug: string): string {
  const root = process.env.TENANT_ROOT_DOMAIN ?? "ficha.tecnocloud.es";
  const isLocal = root === "localhost" || root.includes("localhost");
  const proto = isLocal ? "http" : "https";
  const port = isLocal ? ":3000" : "";
  return `${proto}://${slug}.${root}${port}`;
}

export interface CreateCheckoutInput {
  tenantId: string;
  tenantSlug: string;
  planKey: PlanKey;
  empleadosActivos: number;
  /** Si la subscription actual está en trial o no existe, podemos
   * ofrecer 14 días de trial. */
  offerTrial?: boolean;
}

export interface CheckoutResult {
  url: string;
  sessionId: string;
  quantity: number;
}

/**
 * Crea una Stripe Checkout Session para iniciar/cambiar de plan.
 *
 * Llamado por el endpoint POST /api/billing/checkout.
 * Devuelve la URL hosted que el frontend debe abrir.
 */
export async function createCheckoutSession(
  input: CreateCheckoutInput,
): Promise<CheckoutResult> {
  const priceId = getPlanPriceId(input.planKey, "monthly");
  if (!priceId) {
    throw new Error(
      `Plan ${input.planKey} no configurado en Stripe (falta STRIPE_PRICE_${input.planKey.toUpperCase()}_MONTHLY).`,
    );
  }

  const customerId = await getOrCreateStripeCustomer(input.tenantId);
  const quantity = calculateQuantity(input.empleadosActivos, input.planKey);
  const base = tenantBaseUrl(input.tenantSlug);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity }],
    client_reference_id: input.tenantId,
    metadata: {
      tenant_id: input.tenantId,
      tenant_slug: input.tenantSlug,
      plan_key: input.planKey,
    },
    subscription_data: {
      metadata: {
        tenant_id: input.tenantId,
        tenant_slug: input.tenantSlug,
        plan_key: input.planKey,
      },
      ...(input.offerTrial ? { trial_period_days: 14 } : {}),
    },
    success_url: `${base}/admin/facturacion/exito?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/admin/facturacion/cancelado`,
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error("Stripe no devolvió URL de checkout.");
  }

  return { url: session.url, sessionId: session.id, quantity };
}
