/**
 * STUB — implementación real en Fase 3.
 *
 * tenants:migrate aplica las migraciones del producto al schema
 * tenant_<slug> de un tenant existente. tenants:migrate:all itera todos
 * los tenants ACTIVE/SUSPENDED y aplica.
 *
 * En el flow de deploy (ADR-005 §2.5): entrypoint.sh ejecuta primero
 * `prisma migrate deploy` al control plane (master), luego corre
 * `tenants:migrate:all` que itera tenants y aplica las migraciones del
 * producto a cada schema con SET search_path. Si una falla, aborta el
 * deploy entero (ADR-005 §3.3).
 *
 * En Fase 2 este archivo es un stub que documenta el contrato y sale con
 * código 1 si se invoca. Implementación en Fase 3.
 */

const MIGRATE_USAGE = `
tenants:migrate <slug>     — aplica migraciones del producto al schema tenant_<slug>.
tenants:migrate:all        — itera todos los tenants ACTIVE/SUSPENDED.

NOTA: este comando se materializa en Fase 3. En Fase 2 sale con
exit 1 sin hacer nada. Ver:
  - ADR-001 §5.2 (comando CLI)
  - ADR-005 §2.5 + §3.3 (entrypoint y manejo de fallos)
  - docs/arch/00-fase-2-plan.md §8.4
`;

console.error(MIGRATE_USAGE.trim());
console.error("\n[stub] Implementación en Fase 3. Saliendo con exit 1.");
process.exit(1);
