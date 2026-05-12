/**
 * No-op desde 2026-05-12. Las ALTER/CREATE TABLE que vivían aquí como
 * "lazy migrations" se consolidaron en la migración formal
 * `prisma/migrations-tenant/20260512170000_sprint3_lazy_to_formal/`,
 * que se aplica automáticamente por `provisionTenantSchema` al crear
 * cada tenant nuevo.
 *
 * Razón: las lazy migrations eran frágiles —
 *   1. Sólo se aplicaban al primer request de cada tenant, pero el
 *      provisioning del webhook checkout intentaba el primer INSERT
 *      del OWNER *antes* del primer request, fallando con ColumnNotFound
 *      en `empresaId` (incidente 12-may con tenant "mobileshop").
 *   2. No tenían tracking persistente — cualquier restart del proceso
 *      reejecutaba todos los ALTER (idempotentes pero ruidosos).
 *   3. No quedaba claro qué versión de schema correspondía a cada
 *      tenant — drift entre `tenant_template` y tenants en uso.
 *
 * Mantenemos el export `runMigrations` y la firma async como no-op
 * para no tener que tocar los ~11 sitios que la importan. Cuando se
 * confirme estable, se pueden borrar esas llamadas en una limpieza
 * posterior.
 */

export async function runMigrations(): Promise<void> {
  // No-op. Ver docstring del módulo.
}
