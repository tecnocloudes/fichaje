/**
 * Wrapper retro-compatible: redirige a `sendSystemEmail` en
 * `@/lib/email`. Plan Fase 5 §15.4 + TODO N17.
 *
 * Antes era el helper directo. Ahora se unifica en `@/lib/email`:
 * - `sendEmail` (con gates feature + quota) para flows del tenant.
 * - `sendSystemEmail` (sin gates) para flows de plataforma (Stripe
 *   handlers, worker, super-admin).
 *
 * Este file se mantiene SOLO por compatibilidad con los imports
 * existentes en `src/lib/stripe/handlers/*`. Refactor opcional Fase 9
 * (mover los Stripe handlers a `import { sendSystemEmail } from
 * "@/lib/email"`).
 */

import { sendSystemEmail } from "@/lib/email";

export type SendEmailParams = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendEmail(params: SendEmailParams): Promise<void> {
  await sendSystemEmail(params.to, params.subject, params.html, {
    from: params.from,
    text: params.text,
  });
}
