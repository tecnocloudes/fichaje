/**
 * Webhook Stripe. ADR-003 §2.3.c + §2.4 + §2.5.
 *
 * - Sin auth NextAuth, sin withTenant. Vive en subdominio `app`.
 * - Verifica firma con stripe.webhooks.constructEvent + STRIPE_WEBHOOK_SECRET.
 * - Idempotencia con master.stripe_events (recordEventOrSkip).
 * - Dispatch via lista blanca (9 eventos, ADR-003 §2.3.a). Default
 *   branch del switch ignora silenciosamente.
 *
 * Body raw obligatorio (`req.text()`). NO `req.json()` — la
 * verificación de firma se calcula sobre los bytes exactos.
 */

import { type NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import {
  recordEventOrSkip,
  markProcessed,
  markErrored,
} from "@/lib/stripe/idempotency";
import { dispatchEvent } from "@/lib/stripe/dispatch";

export async function POST(req: NextRequest): Promise<Response> {
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return new NextResponse("Missing signature", { status: 400 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET no definida.");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const body = await req.text(); // RAW, NO json()

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch {
    return new NextResponse("Invalid signature", { status: 400 });
  }

  // Idempotencia: INSERT ON CONFLICT. Si replay, devolver 200 sin
  // reentrar al handler.
  const fresh = await recordEventOrSkip(event);
  if (!fresh) {
    return new NextResponse(null, { status: 200 });
  }

  try {
    await dispatchEvent(event);
    await markProcessed(event.id);
    return new NextResponse(null, { status: 200 });
  } catch (err) {
    await markErrored(event.id, err);
    // 500 → Stripe reintenta. El INSERT idempotente del paso anterior
    // garantiza que el retry no duplique side-effects (ON CONFLICT
    // gana y devolvemos 200 sin reentrar).
    console.error("Stripe webhook error:", err);
    return new NextResponse("Handler error", { status: 500 });
  }
}
