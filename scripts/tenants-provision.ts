/**
 * STUB — implementación real en Fase 4.
 *
 * tenants:provision crea un tenant nuevo: inserta fila en master.tenants,
 * crea el schema tenant_<slug> con master_role, aplica las migraciones del
 * producto, crea el primer OWNER con app_role, y deja el tenant en ACTIVE.
 *
 * Coreografía completa en ADR-003 §2.6 (tras checkout.session.completed)
 * y ADR-004 §5.4 (cutover del cliente actual).
 *
 * En Fase 2 este archivo es un stub que documenta el contrato y sale con
 * código 1 si se invoca. Implementación en Fase 4.
 */

const PROVISION_USAGE = `
tenants:provision <slug> <plan_key>

Crea un tenant nuevo en master.tenants + schema tenant_<slug> +
migraciones del producto + primer OWNER. Idempotente al fallo: si el
tenant existe en estado PROVISIONING, retoma desde el último paso
exitoso (ADR-003 §5.2 job de detección).

Argumentos:
  <slug>      slug del tenant (regex ^[a-z][a-z0-9_]{2,30}$).
  <plan_key>  starter | pro | enterprise.

Ejemplo:
  npm run tenants:provision -- telecom enterprise

NOTA: este comando se materializa en Fase 4. En Fase 2 sale con
exit 1 sin hacer nada. Ver:
  - ADR-003 §2.6 (coreografía)
  - ADR-004 §5.4 (cutover del cliente actual)
  - docs/arch/00-fase-2-plan.md §8.3
`;

console.error(PROVISION_USAGE.trim());
console.error("\n[stub] Implementación en Fase 4. Saliendo con exit 1.");
process.exit(1);
