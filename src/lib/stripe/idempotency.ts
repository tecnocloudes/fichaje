/**
 * Capa de idempotencia para webhooks Stripe. ADR-003 §2.4.
 *
 * Tres operaciones:
 *  - recordEventOrSkip(event): INSERT en master.stripe_events con
 *    `ON CONFLICT (event_id) DO NOTHING RETURNING`. Devuelve true si
 *    es la primera vez que vemos el event_id (handler debe procesar);
 *    false si es replay (handler debe responder 200 sin reentrar).
 *  - markProcessed(eventId): tras handler OK, setea processed_at = now.
 *  - markErrored(eventId, err): tras handler que lanza, escribe
 *    processing_error y deja processed_at en NULL (Stripe reintentará).
 *
 * Las tres usan `prismaMaster` (master_role).
 */

import type Stripe from "stripe";
import { prismaMaster } from "@/lib/prisma";

/**
 * Inserta el evento en master.stripe_events. Devuelve `true` si el
 * INSERT añadió fila (primera vez); `false` si CONFLICT (replay).
 *
 * Idempotencia de side-effects: el caller debe procesar solo si recibe
 * `true`. El INSERT precede al procesamiento — ADR-003 §2.4 razón: si
 * el proceso muere entre el INSERT y el handler, el job de detección
 * (commit 19) recoge la fila con `processed_at = NULL` y reintenta.
 */
export async function recordEventOrSkip(event: Stripe.Event): Promise<boolean> {
  const rows = await prismaMaster.$queryRaw<{ event_id: string }[]>`
    INSERT INTO master.stripe_events (
      event_id, type, api_version, created_at, payload
    )
    VALUES (
      ${event.id},
      ${event.type},
      ${event.api_version ?? "unknown"},
      to_timestamp(${event.created}),
      ${JSON.stringify(event)}::jsonb
    )
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `;
  return rows.length > 0;
}

/**
 * Marca el evento como procesado correctamente. Idempotente — si se
 * llama dos veces, simplemente actualiza processed_at al timestamp más
 * reciente.
 */
export async function markProcessed(eventId: string): Promise<void> {
  await prismaMaster.stripeEvent.update({
    where: { eventId },
    data: { processedAt: new Date() },
  });
}

/**
 * Marca el evento con un error de procesamiento. Stripe reintentará.
 * Si tras 3 intentos sigue fallando, el job de detección (commit 19)
 * alerta al super-admin.
 */
export async function markErrored(eventId: string, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  // Truncar mensaje para no llenar la BD con stacks gigantes.
  const truncated = msg.slice(0, 2000);
  await prismaMaster.stripeEvent.update({
    where: { eventId },
    data: { processingError: truncated },
  });
}
