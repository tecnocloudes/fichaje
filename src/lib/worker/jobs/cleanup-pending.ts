/**
 * Job: limpiar tenants PENDING > 24h. ADR-003 §5.2 + §2.6.
 *
 * Si un usuario abandona el Checkout (cierra navegador, no completa
 * pago en 24h), su fila en master.tenants queda en status=pending
 * con stripe_customer_id=NULL. Este job los borra y libera el slug.
 */

import { prismaMaster } from "@/lib/prisma";

export async function cleanupPendingTenants(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prismaMaster.tenant.deleteMany({
    where: {
      status: "pending",
      createdAt: { lt: cutoff },
    },
  });
  return result.count;
}
