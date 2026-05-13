/**
 * Conector Slack del marketplace.
 *
 * Activación: el OWNER instala la integración `slack` y guarda en
 * `IntegracionInstalada.configuracion.webhookUrl` una incoming-webhook
 * URL generada en api.slack.com/apps. No usamos OAuth — incoming
 * webhooks son la opción más simple y suficiente para outbound.
 *
 * Uso: `await notifySlackIfInstalled("Nueva ausencia de Juan Pérez")`.
 * Si no está instalada o no tiene webhookUrl, no-op.
 */

import { prismaApp } from "@/lib/prisma";

const SLACK_SLUG = "slack";

export async function notifySlackIfInstalled(text: string): Promise<void> {
  try {
    const integ = await prismaApp.integracion.findUnique({
      where: { slug: SLACK_SLUG },
      include: {
        instalaciones: {
          where: { activa: true },
          select: { configuracion: true },
          take: 1,
        },
      },
    });
    if (!integ) return;
    const config = integ.instalaciones[0]?.configuracion as
      | { webhookUrl?: string; canal?: string }
      | null
      | undefined;
    const webhookUrl = config?.webhookUrl;
    if (!webhookUrl || !/^https:\/\/hooks\.slack\.com\//.test(webhookUrl)) return;
    const body = {
      text,
      ...(config.canal ? { channel: config.canal } : {}),
    };
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch((err) => {
      console.warn("[slack] envío falló:", (err as Error).message);
    });
  } catch (err) {
    console.warn("[slack] notify error:", (err as Error).message);
  }
}
