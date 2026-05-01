/**
 * Helpers de envío de push notifications. Plan Fase 5 §15.4 + TODO N17.
 *
 * - `sendPush(userId, title, body, url?)`: envío DEL TENANT.
 *   Chequea `notificaciones_push` y consume quota `pushs_mes`.
 *   Llamar dentro de `runWithTenant`. Devuelve `{ ok: false, reason }`
 *   si feature OFF o quota agotada.
 *
 * No hay `sendSystemPush()` por ahora — ningún flow de plataforma
 * dispara push.
 */

import webpush from "web-push";
import { prismaApp } from "./prisma";
import { hasFeature, consumeQuota } from "@/lib/tenant/features";
import { maybeCurrentTenant } from "@/lib/tenant/context";

export type SendPushResult =
  | { ok: true; sent: number }
  | {
      ok: false;
      reason:
        | "feature_not_contracted"
        | "quota_exceeded"
        | "vapid_not_configured"
        | "no_tenant_context";
    };

export async function sendPush(
  userId: string,
  title: string,
  body: string,
  url?: string,
): Promise<SendPushResult> {
  if (!maybeCurrentTenant()) {
    return { ok: false, reason: "no_tenant_context" };
  }
  if (!hasFeature("notificaciones_push")) {
    return { ok: false, reason: "feature_not_contracted" };
  }
  const consume = await consumeQuota("pushs_mes", 1);
  if (!consume.ok) {
    return { ok: false, reason: "quota_exceeded" };
  }

  const config = await prismaApp.configuracionEmpresa.findFirst();
  if (
    !config?.pushActivo ||
    !config?.pushVapidPublicKey ||
    !config?.pushVapidPrivateKey
  ) {
    return { ok: false, reason: "vapid_not_configured" };
  }

  webpush.setVapidDetails(
    `mailto:${config.emailFrom ?? "noreply@empresa.com"}`,
    config.pushVapidPublicKey,
    config.pushVapidPrivateKey,
  );

  const subscriptions = await prismaApp.pushSubscripcion.findMany({
    where: { userId },
  });

  const payload = JSON.stringify({ title, body, url: url ?? "/" });

  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent += 1;
    } catch {
      // Subscription inválida o expirada — se elimina.
      await prismaApp.pushSubscripcion
        .delete({ where: { id: sub.id } })
        .catch(() => {});
    }
  }
  return { ok: true, sent };
}
