/**
 * POST /api/billing/checkout — inicia un Stripe Checkout para que el OWNER
 * del tenant cambie de plan.
 *
 * Body: { planKey: "starter" | "pro" | "enterprise" }
 *
 * Response: 200 { url, sessionId, quantity } ó 4xx con { error, code? }
 *
 * Auth: solo OWNER (rol del JWT) del tenant logueado. La resolución del
 * tenant viene de `withTenant` (host → tenantSlug) y se cross-valida con
 * `JWT.tenantSlug`.
 *
 * Lógica:
 *   1. Cuenta los empleados activos del tenant (prismaApp.user).
 *   2. Calcula la quantity de seats con el mínimo del plan
 *      (`calculateQuantity` honra el minimo monthly).
 *   3. Crea (o reutiliza) Stripe Customer.
 *   4. Crea Checkout Session monthly con metadata del tenant.
 *   5. Devuelve la URL para que el frontend redirija.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp, prismaMaster } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { currentTenant } from "@/lib/tenant/context";
import { createCheckoutSession } from "@/lib/billing/checkout";
import { PLAN_PRICING } from "@/lib/billing/plan-pricing";

const bodySchema = z.object({
  planKey: z.enum(["starter", "pro", "enterprise"]),
});

export const POST = withTenant(async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as { rol?: string } | undefined;
  if (!user || user.rol !== Rol.OWNER) {
    return NextResponse.json(
      { error: "Solo el OWNER puede gestionar la facturación." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "planKey requerido (starter|pro|enterprise)" },
      { status: 400 },
    );
  }
  const planKey = parsed.data.planKey;

  const ctx = currentTenant();

  // Empleados activos del tenant. Solo cuentan los `activo: true` —
  // el modelo per-seat factura por usuarios que efectivamente usan
  // la plataforma (alineado con el cap `max_employees`).
  const empleadosActivos = await prismaApp.user.count({
    where: { activo: true },
  });

  // ¿Tiene subscription activa? Si no, ofrecemos trial 14 días.
  const existingSub = await prismaMaster.subscription.findFirst({
    where: {
      tenantId: ctx.tenantId,
      status: { in: ["active", "trialing", "past_due"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, planKey: true, status: true },
  });
  const offerTrial = !existingSub;

  try {
    const result = await createCheckoutSession({
      tenantId: ctx.tenantId,
      tenantSlug: ctx.slug,
      planKey,
      empleadosActivos,
      offerTrial,
    });
    return NextResponse.json({
      ...result,
      planLabel: PLAN_PRICING[planKey].displayName,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error de Stripe";
    console.error("[/api/billing/checkout]", message);
    return NextResponse.json(
      { error: message, code: "stripe_error" },
      { status: 500 },
    );
  }
});
