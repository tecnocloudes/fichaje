/**
 * handlePaymentFailed. ADR-003 §2.3.a.
 *
 * Disparado por Stripe `invoice.payment_failed`. NO suspendemos el
 * tenant aquí — Stripe inicia su dunning automático (~14 días de
 * reintentos). Solo:
 *  1. UPDATE master.subscriptions.status = 'past_due'.
 *  2. Email al OWNER avisando del fallo de pago.
 *
 * Si tras 14 días sigue sin pagar, Stripe emite
 * `customer.subscription.deleted` (o `paused` según config) y el
 * handler correspondiente suspende el tenant. ADR-003 §2.3.a + §3.4.
 */

import type Stripe from "stripe";
import { prismaMaster } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";

export async function handlePaymentFailed(
  event: Stripe.Event,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  if (!invoice.subscription) return;

  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription.id;
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : (invoice.customer?.id ?? null);
  if (!customerId) return;

  const tenant = await prismaMaster.tenant.findUnique({
    where: { stripeCustomerId: customerId },
  });
  if (!tenant) return;

  await prismaMaster.subscription.updateMany({
    where: { stripeSubscriptionId: subscriptionId },
    data: { status: "past_due" },
  });

  // Email aviso. En dev sin RESEND_API_KEY → mock por consola.
  await sendEmail({
    to: tenant.email,
    from: process.env.EMAIL_FROM ?? "no-reply@ficha.tecnocloud.es",
    subject: "Pago rechazado — actualiza tu método de pago",
    html: `
<p>Hola,</p>
<p>El último cobro de tu suscripción <strong>${tenant.slug}</strong> ha sido rechazado por tu banco.</p>
<p>Stripe reintentará automáticamente durante los próximos 14 días. Para evitar la suspensión de tu cuenta, actualiza tu método de pago en el portal de facturación.</p>
<p style="text-align:center;margin:24px 0;">
  <a href="https://${tenant.slug}.${process.env.TENANT_ROOT_DOMAIN ?? "ficha.tecnocloud.es"}/configuracion/facturacion"
     style="background:#ef4444;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;">
    Actualizar método de pago
  </a>
</p>
`.trim(),
    text: `El último cobro de tu suscripción ${tenant.slug} ha sido rechazado. Stripe reintentará automáticamente. Actualiza tu método de pago en /configuracion/facturacion.`,
  });
}
