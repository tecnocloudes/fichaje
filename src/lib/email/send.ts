/**
 * Envío de emails. Usa Resend si RESEND_API_KEY está definida y no
 * vacía; en otro caso, fallback a console.log para desarrollo.
 *
 * §15.4 del plan de Fase 4 — el provider se infiere de la presencia
 * de RESEND_API_KEY.
 */

import { Resend } from "resend";

export type SendEmailParams = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    // Fallback dev: mock por consola (no bloquea el flow).
    console.log("[email mock]", {
      to: params.to,
      subject: params.subject,
      preview: params.text.slice(0, 200),
    });
    return;
  }
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from: params.from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  });
  if (result.error) {
    throw new Error(
      `Resend error: ${result.error.name}: ${result.error.message}`,
    );
  }
}
