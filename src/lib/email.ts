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
interface SystemEmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  /** Para inline images: marcar el cid que se referencia en el HTML como `cid:logo`. */
  contentId?: string;
}

export async function sendSystemEmail(
  to: string,
  subject: string,
  html: string,
  opts: {
    from?: string;
    text?: string;
    attachments?: SystemEmailAttachment[];
  } = {},
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    opts.from ??
    process.env.SYSTEM_EMAIL_FROM ??
    process.env.EMAIL_FROM ??
    "noreply@resend.dev";

  // Si el HTML contiene <img src="data:image/...;base64,..."> los inline-amos
  // como attachments con CID. Gmail/Outlook bloquean data:URLs por seguridad,
  // pero CID inline sí lo aceptan.
  const { html: rewrittenHtml, attachments: dataAttachments } =
    extractDataUrlsToCidAttachments(html);
  const allAttachments = [...(opts.attachments ?? []), ...dataAttachments];

  if (!apiKey) {
    console.log("[email-system mock]", { to, subject, from, attachments: allAttachments.length });
    return;
  }
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to,
    subject,
    html: rewrittenHtml,
    ...(opts.text ? { text: opts.text } : {}),
    ...(allAttachments.length > 0
      ? {
          attachments: allAttachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            ...(a.contentType ? { contentType: a.contentType } : {}),
            ...(a.contentId ? { contentId: a.contentId } : {}),
          })),
        }
      : {}),
  });
  if (result.error) {
    console.error("[sendSystemEmail] Resend error", { to, from, error: result.error });
    throw new Error(
      `Resend error: ${result.error.name}: ${result.error.message}`,
    );
  }
}

/**
 * Sustituye las imágenes data:URL del HTML por referencias `cid:<id>`
 * y devuelve los attachments inline correspondientes. Necesario para
 * que el logo del tenant (guardado como base64 en BD) se vea en Gmail
 * y otros clientes que bloquean data:URLs.
 */
function extractDataUrlsToCidAttachments(
  html: string,
): { html: string; attachments: SystemEmailAttachment[] } {
  const attachments: SystemEmailAttachment[] = [];
  let counter = 0;
  const rewritten = html.replace(
    /src="(data:image\/([a-z]+);base64,([^"]+))"/gi,
    (_match, _full: string, mime: string, b64: string) => {
      counter += 1;
      const cid = `inline-${counter}@empleaia.es`;
      const ext = mime === "jpeg" ? "jpg" : mime;
      attachments.push({
        filename: `inline-${counter}.${ext}`,
        content: Buffer.from(b64, "base64"),
        contentType: `image/${mime}`,
        contentId: cid,
      });
      return `src="cid:${cid}"`;
    },
  );
  return { html: rewritten, attachments };
}
