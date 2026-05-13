/**
 * Webhook WhatsApp Cloud API por tenant.
 *
 * - GET: verificación del webhook por Meta (hub.mode=subscribe).
 *   Reply con hub.challenge si verify_token coincide con env
 *   `WHATSAPP_VERIFY_TOKEN`. Compartido entre tenants — cada tenant
 *   se distingue por la URL `/api/webhooks/whatsapp/<slug>`.
 *
 * - POST: mensajes entrantes y status updates. Verifica firma HMAC con
 *   `WHATSAPP_APP_SECRET`. Resuelve tenant por slug, abre runWithTenant
 *   y guarda mensajes recibidos en MensajeWhatsapp con estado "recibido".
 *
 * Sin auth NextAuth, sin withTenant (whitelist en eslint.config.mjs).
 */

import { type NextRequest, NextResponse } from "next/server";
import { prismaMaster, prismaApp } from "@/lib/prisma";
import { runWithTenant, type TenantContext } from "@/lib/tenant/context";
import { verifyWebhookSignature } from "@/lib/whatsapp/cloud-api";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && verifyToken === expected) {
    // Verificamos también que el slug exista — protege contra mass-scan.
    const tenant = await prismaMaster.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tenant) return new NextResponse("not found", { status: 404 });
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

interface WhatsAppPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body?: string };
        }>;
        statuses?: Array<{ id: string; status: string; recipient_id: string }>;
      };
    }>;
  }>;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const sigOk = await verifyWebhookSignature(rawBody, signature);
  if (!sigOk) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  const tenant = await prismaMaster.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, status: true },
  });
  if (!tenant || tenant.status !== "active") {
    return new NextResponse("not found", { status: 404 });
  }

  let payload: WhatsAppPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  const ctx: TenantContext = {
    tenantId: tenant.id,
    slug: tenant.slug,
    status: "active",
    features: new Map(),
  };

  await runWithTenant(ctx, async () => {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          const texto = msg.text?.body ?? `[${msg.type}]`;
          await prismaApp.mensajeWhatsapp.create({
            data: {
              destinatarioTelefono: msg.from,
              texto: texto.slice(0, 4096),
              estado: "recibido",
            },
          });
        }
        for (const status of change.value?.statuses ?? []) {
          // No persistimos status updates por ahora — sería más útil
          // con una columna providerMessageId que correlacione.
          if (status.status === "failed") {
            console.warn("[whatsapp] status failed", status);
          }
        }
      }
    }
  });

  // Meta requiere 200 rápido — si tardas >20s reintenta.
  return NextResponse.json({ ok: true });
}
