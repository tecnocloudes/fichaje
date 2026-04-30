/**
 * handleTrialWillEnd. ADR-003 §2.3.a + §2.7.
 *
 * Stripe emite este evento 3 días antes del fin del trial. Solo
 * enviamos un email aviso al OWNER. Sin cambio de estado.
 */

import type Stripe from "stripe";
import { prismaMaster } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";

export async function handleTrialWillEnd(
  event: Stripe.Event,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const tenant = await prismaMaster.tenant.findUnique({
    where: { stripeCustomerId: customerId },
  });
  if (!tenant) return;

  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toLocaleDateString("es-ES")
    : "pronto";

  await sendEmail({
    to: tenant.email,
    from: process.env.EMAIL_FROM ?? "no-reply@ficha.tecnocloud.es",
    subject: "Tu trial termina pronto",
    html: `
<p>Hola,</p>
<p>El periodo de prueba de tu cuenta <strong>${tenant.slug}</strong> termina el ${trialEnd}.</p>
<p>Si no quieres continuar, puedes cancelar antes en el portal de facturación.</p>
`.trim(),
    text: `El trial de ${tenant.slug} termina el ${trialEnd}. Si quieres cancelar, hazlo antes en el portal de facturación.`,
  });
}
