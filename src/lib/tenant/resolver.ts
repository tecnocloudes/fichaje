/**
 * Resolución host → TenantContext con cache. ADR-002 §2.3.
 *
 * Orquesta:
 *  1. parseHost(host) → categoría.
 *  2. Si kind=tenant: cache → BD (prismaRuntime.tenant.findUnique +
 *     loadFeaturesFor).
 *  3. Cachear el resultado (positivo o negativo).
 *
 * El middleware HTTP (commit 8) consume `resolveTenant(host)` y mapea el
 * `ResolveResult` a códigos HTTP según ADR-002 §2.4.
 *
 * El cliente Prisma + loader de features se inyectan para facilitar tests
 * sin BD. En producción, las dependencias por defecto apuntan a
 * `prismaRuntime` y `loadFeaturesFor`.
 */

import { parseHost } from "@/lib/tenant/host";
import {
  getCachedTenant,
  setCachedHit,
  setCachedMiss,
} from "@/lib/tenant/cache";
import type { TenantContext, TenantStatus } from "@/lib/tenant/context";
import type { ResolvedFeature } from "@/lib/tenant/features";
import { prismaRuntime } from "@/lib/prisma";
import { loadFeaturesFor } from "@/lib/tenant/features";

export type ResolveResult =
  | { kind: "tenant"; ctx: TenantContext }
  | { kind: "app" }
  | { kind: "admin" }
  | { kind: "apex" }
  | { kind: "invalid"; reason: string }
  | { kind: "not_found"; slug: string };

type TenantLookupRow = {
  id: string;
  slug: string;
  status: TenantStatus;
};

export type ResolveDeps = {
  findTenantBySlug: (slug: string) => Promise<TenantLookupRow | null>;
  /**
   * Busca tenant por custom domain verificado. Devuelve null si no
   * existe O si customDomainVerified=false. Plan Fase 6 §4.3.
   * El check de la feature `dominio_personalizado` se hace post-lookup
   * en `resolveTenant` (después de cargar features).
   */
  findTenantByCustomDomain: (host: string) => Promise<TenantLookupRow | null>;
  loadFeaturesFor: (tenantId: string) => Promise<Map<string, ResolvedFeature>>;
};

const defaultDeps: ResolveDeps = {
  async findTenantBySlug(slug) {
    return prismaRuntime.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true },
    });
  },
  async findTenantByCustomDomain(host) {
    return prismaRuntime.tenant.findFirst({
      where: { customDomain: host, customDomainVerified: true },
      select: { id: true, slug: true, status: true },
    });
  },
  loadFeaturesFor,
};

export async function resolveTenant(
  host: string | null | undefined,
  deps: ResolveDeps = defaultDeps,
): Promise<ResolveResult> {
  const parsed = parseHost(host);
  if (parsed.kind === "app") return { kind: "app" };
  if (parsed.kind === "admin") return { kind: "admin" };
  if (parsed.kind === "apex") return { kind: "apex" };
  if (parsed.kind === "invalid") return { kind: "invalid", reason: parsed.reason };

  const hostKey = (host ?? "").toLowerCase();

  // Cache primero.
  const cached = getCachedTenant(hostKey);
  if (cached?.kind === "hit") return { kind: "tenant", ctx: cached.ctx };
  if (cached?.kind === "miss") {
    return parsed.kind === "tenant"
      ? { kind: "not_found", slug: parsed.slug }
      : { kind: "invalid", reason: "custom domain no verificado" };
  }

  // Lookup en BD según kind.
  let row: TenantLookupRow | null = null;
  if (parsed.kind === "tenant") {
    row = await deps.findTenantBySlug(parsed.slug);
    if (!row) {
      setCachedMiss(hostKey, "tenant no existe");
      return { kind: "not_found", slug: parsed.slug };
    }
  } else {
    // custom_domain_candidate
    row = await deps.findTenantByCustomDomain(parsed.host);
    if (!row) {
      setCachedMiss(hostKey, "custom domain no encontrado");
      return { kind: "invalid", reason: "custom domain no registrado o no verificado" };
    }
  }

  // Carga features (siempre para tenant — coste ~1 query por miss).
  const features = await deps.loadFeaturesFor(row.id);

  // Para custom_domain: requerir feature dominio_personalizado activa.
  // Si la feature está OFF (downgrade del plan), el host no resuelve
  // aunque el dominio esté verificado en BD. Plan Fase 6 §15.6.
  if (parsed.kind === "custom_domain_candidate") {
    const feature = features.get("dominio_personalizado");
    const active = feature?.value === true;
    if (!active) {
      setCachedMiss(hostKey, "feature dominio_personalizado inactiva");
      return { kind: "invalid", reason: "custom domain feature inactiva" };
    }
  }

  const ctx: TenantContext = {
    tenantId: row.id,
    slug: row.slug,
    status: row.status,
    features,
  };
  setCachedHit(hostKey, ctx);
  return { kind: "tenant", ctx };
}
