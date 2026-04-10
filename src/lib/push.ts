import webpush from "web-push";
import { prisma } from "./prisma";

export async function sendPush(
  userId: string,
  title: string,
  body: string,
  url?: string
) {
  const config = await prisma.configuracionEmpresa.findFirst();
  if (
    !config?.pushActivo ||
    !config?.pushVapidPublicKey ||
    !config?.pushVapidPrivateKey
  )
    return;

  webpush.setVapidDetails(
    `mailto:${config.emailFrom ?? "noreply@empresa.com"}`,
    config.pushVapidPublicKey,
    config.pushVapidPrivateKey
  );

  const subscriptions = await prisma.pushSubscripcion.findMany({
    where: { userId },
  });

  const payload = JSON.stringify({ title, body, url: url ?? "/" });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch {
      // Subscription inválida o expirada — se elimina
      await prisma.pushSubscripcion
        .delete({ where: { id: sub.id } })
        .catch(() => {});
    }
  }
}
