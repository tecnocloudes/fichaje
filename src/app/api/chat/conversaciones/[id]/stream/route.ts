/**
 * GET /api/chat/conversaciones/[id]/stream — Server-Sent Events.
 *
 * Reemplaza el polling cada 4 s del cliente por un stream `text/event-stream`
 * que el servidor mantiene abierto. Internamente el servidor consulta la
 * BD cada 2 s; si hay mensajes nuevos los emite como eventos `message`.
 * Cuando no los hay manda un `ping` cada 15 s para que el navegador
 * no cierre la conexión.
 *
 * Limitaciones:
 * - No usa LISTEN/NOTIFY (Prisma no expone canal directo). El polling
 *   queda en el servidor — el cliente deja de hacer fetch repetido.
 * - El stream se cierra si el cliente desconecta (via `req.signal`).
 *
 * Feature: chat. Solo participantes.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const dynamic = "force-dynamic";

const POLL_MS = 2000;
const PING_MS = 15_000;

export const GET = withTenant(withFeature("chat", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const { id } = await params;

  const part = await prisma.participanteConversacion.findUnique({
    where: { conversacionId_userId: { conversacionId: id, userId } },
    select: { id: true },
  });
  if (!part) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const encoder = new TextEncoder();
  const sinceParam = req.nextUrl.searchParams.get("since");
  let lastTs = sinceParam ? new Date(sinceParam) : new Date();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        safeEnqueue(encoder.encode(payload));
      };

      send("ready", { since: lastTs.toISOString() });

      const pingTimer = setInterval(() => {
        if (closed) return;
        safeEnqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
      }, PING_MS);

      const pollTimer = setInterval(async () => {
        if (closed) return;
        try {
          const mensajes = await prisma.mensaje.findMany({
            where: { conversacionId: id, createdAt: { gt: lastTs } },
            orderBy: { createdAt: "asc" },
            take: 50,
            include: {
              autor: { select: { id: true, nombre: true, apellidos: true, foto: true } },
            },
          });
          if (mensajes.length > 0) {
            for (const m of mensajes) send("message", m);
            lastTs = mensajes[mensajes.length - 1].createdAt;
            await prisma.participanteConversacion.update({
              where: { conversacionId_userId: { conversacionId: id, userId } },
              data: { ultimoLeidoAt: new Date() },
            });
          }
        } catch (err) {
          send("error", { message: (err as Error).message });
        }
      }, POLL_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(pingTimer);
        clearInterval(pollTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}));
