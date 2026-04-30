/**
 * Job: detectar tenants PROVISIONING > 10 min huérfanos.
 * ADR-003 §5.2.
 *
 * Si la coreografía falla a mitad (e.g. CREATE SCHEMA OK pero
 * stripe.subscriptions.retrieve falla por timeout de red), el tenant
 * queda en status=provisioning y processing_error en stripe_events.
 * Este job:
 *   1. Detecta tenants stuck (provisioning > 10 min).
 *   2. Cuenta intentos previos en stripe_events para esa subscription.
 *   3. Si <3 intentos: re-encolar el handler (Fase 4 inicial: log
 *      warning para que el operador lo revise; Fase 9 con BullMQ
 *      hace push a la cola).
 *   4. Si ≥3 intentos: alerta crítica (email super-admin + audit_log).
 *      Por ahora: log error.
 *
 * Devuelve la lista de tenants stuck para tests.
 */

import { prismaMaster } from "@/lib/prisma";

export type StuckTenant = {
  id: string;
  slug: string;
  retryCount: number;
};

export async function detectProvisioningStuck(): Promise<StuckTenant[]> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const stuck = await prismaMaster.tenant.findMany({
    where: {
      status: "provisioning",
      updatedAt: { lt: cutoff },
    },
    select: { id: true, slug: true },
  });

  const out: StuckTenant[] = [];
  for (const t of stuck) {
    // Contar errores en stripe_events para este tenant. Heurística:
    // todos los stripe_events con processing_error LIKE %tenantId% o
    // que mencionen el slug. Para Fase 4 inicial es suficiente con
    // contar todos los stripe_events con error en las últimas 24h —
    // el super-admin verá el contexto al investigar.
    const errorEvents = await prismaMaster.stripeEvent.count({
      where: {
        processingError: { not: null },
        receivedAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    out.push({ id: t.id, slug: t.slug, retryCount: errorEvents });

    if (errorEvents >= 3) {
      console.error(
        `[stuck-tenant] CRITICAL: tenant ${t.slug} provisioning con ${errorEvents}+ errores. Necesita intervención super-admin.`,
      );
      // TODO Fase 7: insertar en master.audit_log con severity=critical.
      // TODO Fase 4 final: enviar email a SUPER_ADMIN.
    } else {
      console.warn(
        `[stuck-tenant] tenant ${t.slug} provisioning > 10 min (intentos: ${errorEvents}). Reintentar manualmente con tenants:provision o esperar a próximo evento Stripe.`,
      );
      // TODO Fase 9: re-enqueue en BullMQ.
    }
  }
  return out;
}
