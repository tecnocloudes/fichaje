/**
 * Cache in-memory de tenants resueltos por host. ADR-002 §2.3.
 *
 * - **Hit positivo**: Map<host, ResolvedEntry> con TTL configurable
 *   (default 60_000 ms, env TENANT_CACHE_TTL_MS).
 * - **Hit negativo (host inexistente)**: TTL más corto (default 5_000 ms,
 *   env TENANT_NEGATIVE_CACHE_TTL_MS) para evitar fuerza bruta sobre
 *   subdominios.
 * - **Sin LRU explícito**: el Map crece con cada host único; en producción
 *   no esperamos cardinalidad alta (1 host por tenant + 4 reservados).
 *   Se hará LRU si pasamos de cierta presión.
 *
 * Implementación pura sin imports externos: el Map vive en module scope.
 * Para tests, `_resetCache()` lo vacía. La función es agnóstica al cliente
 * Prisma — solo guarda y recupera entradas que el caller ya resolvió.
 */

import type { TenantContext } from "@/lib/tenant/context";

type ResolvedEntry =
  | { kind: "hit"; ctx: TenantContext; expiresAt: number }
  | { kind: "miss"; reason: string; expiresAt: number };

const cache = new Map<string, ResolvedEntry>();

function getPositiveTtl(): number {
  const v = process.env.TENANT_CACHE_TTL_MS;
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

function getNegativeTtl(): number {
  const v = process.env.TENANT_NEGATIVE_CACHE_TTL_MS;
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5_000;
}

/**
 * Devuelve el resultado cacheado para `host`, o `undefined` si no hay o
 * está expirado. Si está expirado, lo elimina.
 */
export function getCachedTenant(
  host: string,
): { kind: "hit"; ctx: TenantContext } | { kind: "miss"; reason: string } | undefined {
  const entry = cache.get(host);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(host);
    return undefined;
  }
  if (entry.kind === "hit") return { kind: "hit", ctx: entry.ctx };
  return { kind: "miss", reason: entry.reason };
}

export function setCachedHit(host: string, ctx: TenantContext): void {
  cache.set(host, {
    kind: "hit",
    ctx,
    expiresAt: Date.now() + getPositiveTtl(),
  });
}

export function setCachedMiss(host: string, reason: string): void {
  cache.set(host, {
    kind: "miss",
    reason,
    expiresAt: Date.now() + getNegativeTtl(),
  });
}

/** Solo para tests. */
export function _resetCache(): void {
  cache.clear();
}

/** Solo para tests / debugging. */
export function _cacheSize(): number {
  return cache.size;
}
