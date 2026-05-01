/**
 * Helpers de envío de email del producto. Plan Fase 5 §15.4 + TODO N17.
 *
 * - `sendEmail(to, subject, html)`: envío DEL TENANT. Chequea
 *   `notificaciones_email` y consume quota `emails_mes`. Si la
 *   feature está OFF o la quota agotada, NO envía y devuelve
 *   `{ ok: false, reason }`. Debe llamarse dentro de `runWithTenant`.
 *
 * - `sendSystemEmail(to, subject, html)`: envío DE SISTEMA (worker,
 *   super-admin, Stripe handlers). NO chequea features ni consume
 *   quota — operación de plataforma, no del tenant. Plan Fase 5 §15.4.
 *
 * Los emails de invitación a empleados, recuperación de password y
 * notificaciones de eventos pertenecen al tenant — usan `sendEmail`.
 * Los emails de checkout completado, trial-will-end, invoice failed
 * pertenecen al sistema — usan `sendSystemEmail`.
 */

import { Resend } from "resend";
import { prismaApp } from "./prisma";
import { hasFeature, consumeQuota } from "@/lib/tenant/features";
import { maybeCurrentTenant } from "@/lib/tenant/context";

export type SendEmailResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "feature_not_contracted"
        | "quota_exceeded"
        | "smtp_not_configured"
        | "no_tenant_context";
    };

async function getTenantSmtpConfig(): Promise<
  | { activo: true; apiKey: string; from: string }
  | { activo: false }
> {
  const config = await prismaApp.configuracionEmpresa.findFirst({
    select: { emailActivo: true, emailPassword: true, emailFrom: true },
  });
  if (!config?.emailActivo || !config?.emailPassword) {
    return { activo: false };
  }
  return {
    activo: true,
    apiKey: config.emailPassword,
    from: config.emailFrom ?? "noreply@resend.dev",
  };
}

/**
 * Envía un email DEL tenant. Aplica gates feature + quota.
 * Llamar dentro de `runWithTenant`.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<SendEmailResult> {
  if (!maybeCurrentTenant()) {
    return { ok: false, reason: "no_tenant_context" };
  }
  if (!hasFeature("notificaciones_email")) {
    return { ok: false, reason: "feature_not_contracted" };
  }
  const consume = await consumeQuota("emails_mes", 1);
  if (!consume.ok) {
    return { ok: false, reason: "quota_exceeded" };
  }
  const smtp = await getTenantSmtpConfig();
  if (!smtp.activo) {
    return { ok: false, reason: "smtp_not_configured" };
  }
  const resend = new Resend(smtp.apiKey);
  await resend.emails.send({ from: smtp.from, to, subject, html });
  return { ok: true };
}

/**
 * Envía un email DE SISTEMA. Sin gates, sin quotas. Plan §15.4.
 *
 * Solo para flows de plataforma (worker, super-admin, Stripe handlers).
 * NO usar para emails operativos del tenant.
 *
 * Provider: Resend con `RESEND_API_KEY` si está; si no, fallback
 * console.log en dev.
 */
export async function sendSystemEmail(
  to: string,
  subject: string,
  html: string,
  opts: { from?: string; text?: string } = {},
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    opts.from ?? process.env.SYSTEM_EMAIL_FROM ?? "noreply@resend.dev";
  if (!apiKey) {
    console.log("[email-system mock]", { to, subject, from });
    return;
  }
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to,
    subject,
    html,
    ...(opts.text ? { text: opts.text } : {}),
  });
  if (result.error) {
    throw new Error(
      `Resend error: ${result.error.name}: ${result.error.message}`,
    );
  }
}
