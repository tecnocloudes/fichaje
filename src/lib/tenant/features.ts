/**
 * Helpers de runtime para feature flags. ADR-004 §2.1, §2.4.
 *
 * Fase 2: funciones puras sobre `Map<string, ResolvedFeature>` —
 * `hasFeatureInMap`, `getLimitFromMap`, `resolveFeatureRows`.
 *
 * Fase 3 (este archivo): wrappers `hasFeature(key)` y `getLimit(key)`
 * que leen de `currentTenant().features` directamente. consumeQuota se
 * añade en commit 16 con prismaQuotaWriter.
 */

import { prismaMaster, prismaQuotaWriter } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { currentTenant } from "@/lib/tenant/context";

export type FeatureSource = "plan" | "addon" | "manual_override";

export type ResolvedFeature = {
  key: string;
  /** Valor: bool true/false; integer (limit/quota); null = unlimited. */
  value: boolean | number | null;
  source: FeatureSource;
  /** null = sin expiración. */
  expiresAt: Date | null;
};

/**
 * Catálogo de features conocidas. Cargado al arranque del proceso
 * desde `master.features`. Inmutable durante el ciclo de vida del proceso.
 *
 * En Fase 2 se carga la primera vez que cualquier helper la necesita
 * (lazy). En Fase 3 el middleware HTTP la carga al arrancar.
 */
let _featureCatalog: Set<string> | null = null;

export async function loadFeatureCatalog(): Promise<Set<string>> {
  if (_featureCatalog) return _featureCatalog;
  const features = await prismaMaster.feature.findMany({
    select: { key: true },
    where: { active: true },
  });
  _featureCatalog = new Set(features.map((f) => f.key));
  return _featureCatalog;
}

/**
 * Hidrata el catálogo en memoria de proceso con un set de keys.
 * Lo usa `ensureFeatureCatalogLoaded()` (catalog.ts) en runtime y los
 * helpers de tests. Idempotente — re-llamadas reemplazan el set.
 */
export function _hydrateFeatureCatalog(keys: string[]): void {
  _featureCatalog = new Set(keys);
}

/**
 * Resetea el catálogo cacheado. Solo para tests.
 */
export function _resetFeatureCatalogForTest(): void {
  _featureCatalog = null;
}

/**
 * Inyecta un catálogo concreto. Wrapper de _hydrateFeatureCatalog
 * mantenido por compatibilidad con tests existentes.
 */
export function _setFeatureCatalogForTest(keys: string[]): void {
  _hydrateFeatureCatalog(keys);
}

function getCatalogOrThrow(): Set<string> {
  if (!_featureCatalog) {
    throw new Error(
      "FEATURE_CATALOG no cargado. Llama a loadFeatureCatalog() al arranque " +
        "o a _setFeatureCatalogForTest([...]) en tests.",
    );
  }
  return _featureCatalog;
}

function assertKnownFeature(key: string, fn: string): boolean {
  const catalog = getCatalogOrThrow();
  if (catalog.has(key)) return true;
  if (process.env.NODE_ENV !== "production") {
    throw new Error(`${fn} llamado con feature_key desconocida: ${JSON.stringify(key)}`);
  }
  // En producción: log y fail-closed.
  // logger.error({ key, fn }, "unknown feature_key (fail-closed)");
  return false;
}

// ─── getTenantBySlug ─────────────────────────────────────────────────────────

export type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  email: string;
  status: "pending" | "provisioning" | "active" | "suspended" | "deleted";
  stripeCustomerId: string | null;
};

/**
 * Devuelve el tenant por slug, o null si no existe. **No** valida status —
 * el caller decide qué hacer. La validación + mapping a HTTP es trabajo del
 * middleware (Fase 3, ADR-002 §2.4).
 */
export async function getTenantBySlug(slug: string): Promise<TenantSummary | null> {
  return prismaMaster.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      email: true,
      status: true,
      stripeCustomerId: true,
    },
  });
}

// ─── loadFeaturesFor ─────────────────────────────────────────────────────────

/**
 * Carga las features de un tenant aplicando la prioridad
 * `manual_override > addon > plan` para boolean (ADR-003 §2.9 enmendado;
 * el override gana si está presente y vigente) y la regla
 * `plan_value + sum(addons)` para limits y quotas (`manual_override` gana
 * cuando está presente, ADR-003 §2.9 commit 3b7f7e1).
 *
 * Devuelve un Map por feature_key con la fila ganadora. Filtra filas con
 * expires_at en el pasado.
 */
export async function loadFeaturesFor(tenantId: string): Promise<Map<string, ResolvedFeature>> {
  const now = new Date();

  const rows = await prismaMaster.tenantFeature.findMany({
    where: {
      tenantId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      featureKey: true,
      value: true,
      source: true,
      expiresAt: true,
    },
  });

  return resolveFeatureRows(rows);
}

type RawFeatureRow = {
  featureKey: string;
  value: Prisma.JsonValue;
  source: FeatureSource;
  expiresAt: Date | null;
};

const PRIORITY: Record<FeatureSource, number> = {
  manual_override: 3,
  addon: 2,
  plan: 1,
};

/**
 * Aplica la lógica de combinación de fuentes a una lista de filas
 * (sin tocar BD). Exportada para tests.
 */
export function resolveFeatureRows(
  rows: RawFeatureRow[],
): Map<string, ResolvedFeature> {
  // Agrupar por feature_key.
  const byKey = new Map<string, RawFeatureRow[]>();
  for (const row of rows) {
    const list = byKey.get(row.featureKey) ?? [];
    list.push(row);
    byKey.set(row.featureKey, list);
  }

  const result = new Map<string, ResolvedFeature>();

  for (const [key, list] of byKey) {
    // ¿Hay manual_override vigente? Gana siempre.
    const override = list.find((r) => r.source === "manual_override");
    if (override) {
      result.set(key, {
        key,
        value: normalizeJsonValue(override.value),
        source: "manual_override",
        expiresAt: override.expiresAt,
      });
      continue;
    }

    // Sin override: detectar si hay alguna fila booleana o numérica.
    const planRow = list.find((r) => r.source === "plan");
    const addonRows = list.filter((r) => r.source === "addon");

    if (!planRow && addonRows.length === 0) {
      // No debería pasar si el tenant está aprovisionado, pero por defensa:
      continue;
    }

    // Si la fuente plan o cualquiera de las addon es booleana, aplicar OR.
    // Si son numéricas (limit/quota), aplicar plan_value + sum(addons),
    // con null = unlimited (cualquier null gana sobre números).
    const allValues = [
      ...(planRow ? [normalizeJsonValue(planRow.value)] : []),
      ...addonRows.map((r) => normalizeJsonValue(r.value)),
    ];

    const isBoolean = allValues.some((v) => typeof v === "boolean");

    let combined: boolean | number | null;
    if (isBoolean) {
      // OR entre todas las fuentes booleanas.
      combined = allValues.some((v) => v === true);
    } else {
      // Numéricas: si alguna es null (unlimited), el resultado es unlimited.
      if (allValues.some((v) => v === null)) {
        combined = null;
      } else {
        combined = (allValues as number[]).reduce((acc, v) => acc + v, 0);
      }
    }

    // El source declarado es la fuente con prioridad más alta presente.
    const declaredSource: FeatureSource = addonRows.length > 0 ? "addon" : "plan";
    // Si hay plan + addons, declaramos "addon" como fuente "ganadora"
    // semánticamente (la suma proviene de addons sumados al plan).

    // expiresAt: la fecha más temprana entre las fuentes (la primera que expire).
    const expiresAt =
      list
        .map((r) => r.expiresAt)
        .filter((d): d is Date => d !== null)
        .reduce<Date | null>(
          (min, d) => (min === null || d < min ? d : min),
          null,
        );

    result.set(key, {
      key,
      value: combined,
      source: planRow && addonRows.length === 0 ? "plan" : declaredSource,
      expiresAt,
    });
  }

  return result;
}

function normalizeJsonValue(v: Prisma.JsonValue): boolean | number | null {
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v;
  // Para strings o objetos, esto es un error de seed: no debería pasar.
  // Si pasa, fail-closed devolviendo null para no romper el resolver.
  return null;
}

// ─── hasFeature / getLimit ───────────────────────────────────────────────────

/**
 * (Pura) Devuelve `true` si la feature boolean está activa según el Map
 * resuelto. Para keys fuera del catálogo: throw en dev/test, fail-closed
 * en producción (ADR-004 §2.4 enmendado).
 */
export function hasFeatureInMap(
  features: Map<string, ResolvedFeature>,
  key: string,
): boolean {
  if (!assertKnownFeature(key, "hasFeature")) return false;
  const f = features.get(key);
  return f?.value === true;
}

/**
 * (Pura) Devuelve el límite numérico (limit o quota) o null si unlimited.
 * Para feature no aprovisionada en el tenant: 0 (fail-closed).
 */
export function getLimitFromMap(
  features: Map<string, ResolvedFeature>,
  key: string,
): number | null {
  if (!assertKnownFeature(key, "getLimit")) return 0;
  const f = features.get(key);
  if (!f) return 0;
  if (f.value === null) return null;
  if (typeof f.value === "boolean") {
    throw new Error(`getLimit llamado sobre feature boolean: ${key}`);
  }
  return f.value;
}

// ─── Wrappers de runtime que leen currentTenant() ────────────────────────────

/**
 * `hasFeature(key)` lee `currentTenant().features` y delega en
 * `hasFeatureInMap`. Lanza si no hay tenant en contexto (debe llamarse
 * dentro de runWithTenant).
 *
 * ADR-004 §2.4. ADR-002 §2.2.
 */
export function hasFeature(key: string): boolean {
  return hasFeatureInMap(currentTenant().features, key);
}

/**
 * `getLimit(key)` lee `currentTenant().features` y delega en
 * `getLimitFromMap`. Lanza si no hay tenant en contexto.
 */
export function getLimit(key: string): number | null {
  return getLimitFromMap(currentTenant().features, key);
}

// ─── consumeQuota ────────────────────────────────────────────────────────────

export type ConsumeQuotaResult =
  | { ok: true; remaining: number | null; resetAt: Date }
  | { ok: false; reason: "period_unavailable" }
  | {
      ok: false;
      reason: "limit_reached";
      used: number;
      max: number;
      resetAt: Date;
    };

/**
 * Consume `amount` unidades de la quota `key` para el tenant actual de
 * forma atómica. ADR-004 §2.5.
 *
 * Implementación: UPDATE condicional con RETURNING. La condición
 * `consumed + amount <= max` evita la race entre SELECT y UPDATE — si
 * la suma sobrepasa el límite, la fila no se actualiza, RETURNING
 * devuelve 0 filas, y entendemos como `limit_reached`.
 *
 * Diferenciación de fallos:
 * - 0 filas afectadas + sin periodo activo encontrado → period_unavailable.
 * - 0 filas afectadas + periodo encontrado → limit_reached con detalles.
 *
 * Cliente: `prismaQuotaWriter` (rol `quota_writer_role`, ADR-004 §2.2).
 * Solo este módulo lo importa. La regla ESLint `no-quota-writer-leak`
 * (Fase 5) vigila usos indebidos.
 */
export async function consumeQuota(
  key: string,
  amount: number = 1,
): Promise<ConsumeQuotaResult> {
  if (!assertKnownFeature(key, "consumeQuota")) {
    return { ok: false, reason: "period_unavailable" };
  }
  const { tenantId } = currentTenant();

  const updated = await prismaQuotaWriter.$queryRaw<
    { consumed: bigint; max: bigint | null; period_end: Date }[]
  >`
    UPDATE master.tenant_quota_usage
       SET consumed = consumed + ${amount}, updated_at = now()
     WHERE tenant_id = ${tenantId}
       AND feature_key = ${key}
       AND period_start <= now() AND period_end > now()
       AND (max IS NULL OR consumed + ${amount} <= max)
     RETURNING consumed, max, period_end
  `;

  if (updated.length > 0) {
    const r = updated[0]!;
    const remaining =
      r.max === null ? null : Number(r.max) - Number(r.consumed);
    return { ok: true, remaining, resetAt: r.period_end };
  }

  // 0 filas afectadas: distinguir "sin periodo" de "limit alcanzado".
  const current = await prismaQuotaWriter.$queryRaw<
    { consumed: bigint; max: bigint | null; period_end: Date }[]
  >`
    SELECT consumed, max, period_end
      FROM master.tenant_quota_usage
     WHERE tenant_id = ${tenantId} AND feature_key = ${key}
       AND period_start <= now() AND period_end > now()
     LIMIT 1
  `;

  if (current.length === 0) {
    return { ok: false, reason: "period_unavailable" };
  }
  const c = current[0]!;
  return {
    ok: false,
    reason: "limit_reached",
    used: Number(c.consumed),
    max: c.max === null ? Number.POSITIVE_INFINITY : Number(c.max),
    resetAt: c.period_end,
  };
}
