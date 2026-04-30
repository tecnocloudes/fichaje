/**
 * GET /api/onboarding/status?session_id=...
 *
 * Devuelve el status del tenant asociado a una Stripe Checkout
 * Session. Lo usa la página /registro/exito para hacer polling
 * mientras la coreografía del webhook está en marcha.
 *
 * Endpoint exento de withTenant — vive en subdominio app, no es
 * tenant-scoped. Whitelist en eslint.config.mjs ya incluye
 * /api/webhooks/; añadimos /api/onboarding/ para este caso.
 */

import { type NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";
import { prismaMaster } from "@/lib/prisma";

export async function GET(req: NextRequest): Promise<Response> {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "missing session_id" }, { status: 400 });
  }

  // 1. Recuperar la Checkout Session de Stripe para sacar el
  //    client_reference_id (= tenant.id).
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return NextResponse.json({ status: "unknown" }, { status: 200 });
  }
  const tenantId = session.client_reference_id;
  if (!tenantId) {
    return NextResponse.json({ status: "unknown" }, { status: 200 });
  }

  // 2. Lookup tenant en master.
  const tenant = await prismaMaster.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true, slug: true },
  });
  if (!tenant) {
    return NextResponse.json({ status: "unknown" }, { status: 200 });
  }

  return NextResponse.json({
    status: tenant.status,
    slug: tenant.slug,
  });
}
