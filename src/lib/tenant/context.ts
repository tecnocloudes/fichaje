/**
 * Contexto de tenant propagado vía AsyncLocalStorage. ADR-002 §2.2.
 *
 * El middleware HTTP (`src/middleware.ts`, commit 8) resuelve el tenant a
 * partir del Host header, valida su status y carga sus features, y a
 * continuación envuelve el resto del request con `runWithTenant({...}, ...)`.
 *
 * Cualquier código del producto que se ejecute bajo ese envoltorio puede
 * leer el contexto con `currentTenant()`. Si no hay contexto (p. ej. en un
 * worker de fondo o un test mal configurado), `currentTenant()` lanza —
 * defensa en profundidad para el escenario 1 del test de fuga (ADR-001
 * §2.4).
 *
 * Diseño:
 * - **Inmutable**: una vez dentro de `runWithTenant`, el objeto no se
 *   modifica. Si fuese necesario cambiar features dentro del request
 *   (extremadamente raro), se reanida con un nuevo `runWithTenant`.
 * - **Sin efectos colaterales**: este módulo no toca BD ni red. La carga
 *   de features la hace el caller (middleware) antes de envolver.
 * - **Tipos estrictos**: `status` es la enumeración Prisma de master
 *   (`TenantStatus`). Si el tenant llega aquí es porque el middleware ya
 *   validó que es 'active'; el campo se mantiene para auditar/loggear.
 *
 * Para tests sin levantar middleware: usar directamente `runWithTenant({
 *   slug, tenantId, status, features: new Map() }, async () => { ... })`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { ResolvedFeature } from "@/lib/tenant/features";

export type TenantStatus =
  | "pending"
  | "provisioning"
  | "active"
  | "suspended"
  | "deleted";

export type TenantContext = {
  /** Identificador estable, viene de master.tenants.id. */
  tenantId: string;
  /**
   * Slug del tenant (clave del subdominio). Es la fuente de verdad para
   * SET search_path → quoteSchemaName(slug) (commit 4).
   */
  slug: string;
  /** Estado del tenant en master.tenants.status. */
  status: TenantStatus;
  /**
   * Features resueltas (Map<feature_key, ResolvedFeature>). El middleware
   * la pre-carga con `loadFeaturesFor(tenantId)`. hasFeature/getLimit
   * (commit 15) leen de este Map sin tocar BD.
   */
  features: Map<string, ResolvedFeature>;
};

const store = new AsyncLocalStorage<TenantContext>();

/**
 * Ejecuta `fn` con `ctx` como contexto activo. La promesa de `fn`
 * propaga el contexto a través de `await` y server actions.
 *
 * El middleware HTTP (commit 8) lo invoca una vez por request.
 */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return store.run(ctx, fn);
}

/**
 * Devuelve el contexto del tenant activo. Lanza si no hay ninguno.
 *
 * Lanzar es intencional (defensa en profundidad): cualquier query del
 * producto que se ejecute sin contexto debe fallar antes de tocar BD,
 * cerrando el escenario 1 del test de fuga (ADR-001 §2.4).
 */
export function currentTenant(): TenantContext {
  const ctx = store.getStore();
  if (!ctx) {
    throw new Error(
      "No hay tenant en el contexto. ¿Falta el middleware o " +
        "runWithTenant(...) en este código path?",
    );
  }
  return ctx;
}

/**
 * Devuelve el contexto si existe, o `undefined` si no. Útil para
 * branching en código que tolera ausencia (p. ej. logging structured).
 *
 * NUNCA usar para saltarse aislamiento: las queries del producto deben
 * fallar duro si no hay contexto. Esta variante es solo para code paths
 * que legítimamente sirven sin tenant (p. ej. middleware antes de
 * resolver host).
 */
export function maybeCurrentTenant(): TenantContext | undefined {
  return store.getStore();
}
