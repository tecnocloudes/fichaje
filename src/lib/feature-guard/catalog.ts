/**
 * Catálogo de features tipado, cacheado en memoria de proceso.
 *
 * `master.features.type` distingue boolean | limit | quota. Necesario
 * en `/api/me/features` para clasificar correctamente — `tenant_features.value`
 * no carga el tipo. Plan Fase 5 §4.
 *
 * Roles (scripts/sql/00-roles.sql):
 *  - tenant_runtime_role NO tiene SELECT sobre master.features.
 *  - master_role sí. Por eso este loader usa `prismaMaster`.
 *
 * Caché en memoria: el catálogo cambia con un seed, raramente. Restart
 * del proceso invalida. Si en Fase 9 se ve necesidad de hot-reload,
 * añadir un canal pub/sub o TTL.
 */

import { prismaMaster } from "@/lib/prisma";
import { isQuotaPeriod, type QuotaPeriod } from "@/lib/feature-guard/period";
import { _hydrateFeatureCatalog } from "@/lib/tenant/features";

export type FeatureMeta = {
  type: "boolean" | "limit" | "quota";
  quotaPeriod: QuotaPeriod | null;
};

let _cache: Map<string, FeatureMeta> | null = null;
let _loadingPromise: Promise<Map<string, FeatureMeta>> | null = null;

async function loadFromDb(): Promise<Map<string, FeatureMeta>> {
  const rows = await prismaMaster.feature.findMany({
    where: { active: true },
    select: { key: true, type: true, quotaPeriod: true },
  });
  const map = new Map<string, FeatureMeta>();
  for (const row of rows) {
    map.set(row.key, {
      type: row.type as FeatureMeta["type"],
      quotaPeriod: isQuotaPeriod(row.quotaPeriod) ? row.quotaPeriod : null,
    });
  }
  _cache = map;
  // Side effect explícito y documentado: poblar también el Set<string>
  // que usa `assertKnownFeature` en `features.ts`. Sin esto,
  // hasFeature/getLimit/consumeQuota lanzan en runtime.
  _hydrateFeatureCatalog([...map.keys()]);
  return map;
}

export async function loadTypedFeatureCatalog(): Promise<Map<string, FeatureMeta>> {
  if (_cache) return _cache;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = loadFromDb().finally(() => {
    _loadingPromise = null;
  });
  return _loadingPromise;
}

/**
 * Asegura que el catálogo de features (FeatureMeta + Set<string> de
 * keys conocidas) está cargado en memoria de proceso. Idempotente:
 * concurrente-safe (de-duplica via _loadingPromise), no-op si ya hay
 * caché.
 *
 * Llamado por `withTenant` y `withTenantPage` antes de ejecutar el
 * handler. Cualquier `hasFeature/getLimit/consumeQuota` que se ejecute
 * dentro encuentra el catálogo poblado.
 */
export async function ensureFeatureCatalogLoaded(): Promise<void> {
  if (_cache) return;
  await loadTypedFeatureCatalog();
}

/** Solo para tests — invalida la caché del proceso. */
export function _resetTypedCatalogForTest(): void {
  _cache = null;
  _loadingPromise = null;
}
