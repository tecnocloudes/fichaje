/**
 * Cuatro clientes Prisma con roles Postgres distintos.
 *
 * - `prismaMaster`     → master_role: control plane completo. Migraciones,
 *                         seeds, worker (Fase 4), panel super-admin (Fase 7).
 *                         Cliente generado: src/generated/prisma (master).
 * - `prismaApp`        → app_role: schemas tenant_<slug>. Cliente del
 *                         producto, multiplexado por tenant via Proxy (un
 *                         cliente Prisma por tenant cacheado en
 *                         globalThis). Cada cliente se construye con
 *                         PrismaPgOptions.schema = "tenant_<slug>" para que
 *                         el SQL emitido cualifique con ese schema. Pivot
 *                         del diseño original ADR-002 §2.2 (commit 17 leak
 *                         test demostró que SET search_path no funciona con
 *                         Prisma 7 + adapter-pg porque Prisma cualifica el
 *                         SQL con "public" por defecto).
 * - `prismaRuntime`    → tenant_runtime_role: SELECT-only sobre 4 tablas
 *                         master. Usado por el middleware HTTP, hasFeature,
 *                         getLimit y GET /api/me/features. Cliente generado:
 *                         src/generated/prisma (master).
 * - `prismaQuotaWriter` → quota_writer_role: SELECT/INSERT/UPDATE solo sobre
 *                         master.tenant_quota_usage. **Solo** lo importa
 *                         consumeQuota (ADR-004 §2.5). Cliente generado:
 *                         src/generated/prisma (master). Vigilado por la
 *                         regla ESLint custom no-quota-writer-leak (Fase 5).
 *
 * Diseño:
 * - Los 4 clientes son **lazy**: se instancian al primer acceso de propiedad
 *   con un Proxy. Si la env correspondiente falta cuando se accede, lanzan
 *   con mensaje claro indicando qué env falta.
 * - `prismaMaster` puede caer a `DATABASE_URL` si `MASTER_DATABASE_URL` no
 *   está definida (ADR-005 §2.3.a). Fase 8 elimina ese fallback.
 * - En desarrollo, los 4 clientes se cachean en `globalThis` para sobrevivir
 *   al hot reload de Next.
 */

import { PrismaClient as PrismaClientMaster } from "@/generated/prisma/client";
import { PrismaClient as PrismaClientTenant } from "@/generated/prisma-tenant/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { currentTenant } from "@/lib/tenant/context";
import { quoteSchemaName } from "@/lib/tenant/quote";

type CachedClients = {
  prismaMaster?: PrismaClientMaster;
  prismaApp?: PrismaClientTenant;
  prismaRuntime?: PrismaClientMaster;
  prismaQuotaWriter?: PrismaClientMaster;
};

const globalForPrisma = globalThis as unknown as CachedClients;

function createMasterClient(connectionString: string): PrismaClientMaster {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClientMaster({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

/**
 * Cliente Prisma del producto: un cliente por tenant, multiplexado por
 * `currentTenant().slug` mediante un Proxy.
 *
 * Diseño actualizado vs ADR-002 §2.2 (descubrimiento commit 17 leak test):
 *
 *   El plan original era un único cliente Prisma con $extends({ query })
 *   que aplicaba `SET search_path TO "tenant_<slug>"` antes de cada
 *   query. Bloqueador empírico verificado: Prisma 7 cualifica el SQL
 *   con "public"."User" aunque el modelo no tenga @@schema, ignorando
 *   search_path. PrismaPgOptions.schema permite cambiar el schema
 *   cualificado, pero es estático en el constructor del adapter.
 *
 *   Pivot: un cliente Prisma por tenant, construido con
 *   `PrismaPgOptions.schema = "tenant_<slug>"`. El SQL emitido será
 *   `SELECT … FROM "tenant_<slug>"."User"`. Sin search_path, sin race.
 *
 * Memoria: 1 cliente + 1 pool pg por tenant. Para 10–100 tenants
 * activos, ~10–100 conexiones idle. Para >500 tenants se deberá añadir
 * LRU con dispose; Fase 9 lo evalúa cuando llegue volumen.
 *
 * Defensa en profundidad (escenario 1 del test de fuga, ADR-001 §2.4):
 * el Proxy llama `currentTenant()` antes de devolver cualquier modelo,
 * lo que lanza si no hay tenant en contexto. quoteSchemaName valida el
 * slug para que no llegue al SQL un valor con caracteres peligrosos
 * (aunque adapter-pg también los entrecomilla, doble defensa).
 */
function getTenantSchemaName(slug: string): string {
  // Validación regex; lanza si malformado. La cadena devuelta por
  // quoteSchemaName lleva comillas dobles (`"tenant_acme"`); aquí
  // necesitamos el nombre literal sin comillas para PrismaPgOptions.
  // Llamamos a quoteSchemaName solo para validar.
  void quoteSchemaName(slug);
  return `tenant_${slug}`;
}

function buildClientForTenant(
  connectionString: string,
  slug: string,
): PrismaClientTenant {
  const schema = getTenantSchemaName(slug);
  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool, { schema });
  return new PrismaClientTenant({
    adapter,
    log:
      process.env.PRISMA_TENANT_DEBUG === "1"
        ? ["query", "error", "warn"]
        : process.env.NODE_ENV === "development"
          ? ["error", "warn"]
          : ["error"],
  });
}

type TenantClientCache = Map<string, PrismaClientTenant>;

function getTenantClientCache(): TenantClientCache {
  const g = globalForPrisma as unknown as { _tenantClients?: TenantClientCache };
  if (!g._tenantClients) g._tenantClients = new Map();
  return g._tenantClients;
}

/**
 * Invalida el cliente Prisma cacheado para un slug. Usar tras
 * provisionTenantSchema(slug) para forzar que el siguiente
 * `prismaApp.<modelo>` reconstruya el cliente con el schema recién
 * creado (Enmienda 2 del plan de Fase 4 — el cliente Prisma cachea
 * info del schema en su pool al primer connect; si el schema se creó
 * después de la primera consulta, el cliente puede tener una vista
 * obsoleta).
 *
 * También dispone el cliente (cierra el pool pg) si existía.
 */
export function invalidateTenantClient(slug: string): void {
  const cache = getTenantClientCache();
  const existing = cache.get(slug);
  if (existing) {
    // Best-effort dispose: cerrar el pool. Si lanza, ignorar — no es
    // crítico; el cliente nuevo abrirá uno fresco.
    void existing.$disconnect().catch(() => {});
    cache.delete(slug);
  }
}

function buildPrismaAppProxy(): PrismaClientTenant {
  return new Proxy({} as PrismaClientTenant, {
    get(_target, prop) {
      // Lanza si no hay tenant en contexto — defensa en profundidad.
      const { slug } = currentTenant();
      const cache = getTenantClientCache();
      let client = cache.get(slug);
      if (!client) {
        const url =
          process.env["APP_DATABASE_URL"] || process.env["DATABASE_URL"];
        if (!url) {
          throw new Error(
            "Falta APP_DATABASE_URL. Configurar en .env o Dokploy.",
          );
        }
        client = buildClientForTenant(url, slug);
        cache.set(slug, client);
      }
      const value = Reflect.get(client, prop);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined && fallback.length > 0) return fallback;
  throw new Error(
    `Falta la variable de entorno: ${name}. ` +
      `Configurar en .env (Fase 2) o en Dokploy (Fase 8).`,
  );
}

/**
 * Construye un Proxy lazy sobre un cliente Prisma: instancia el cliente real
 * al primer acceso de propiedad. Si la env falta, lanza al primer uso.
 *
 * Genérico para soportar tanto el cliente master como el tenant. El factory
 * se pasa explícito para evitar mezclas de tipos.
 */
function lazyClient<T extends object>(
  envName: string,
  cacheKey: keyof CachedClients,
  factory: (connectionString: string) => T,
  fallbackEnv?: string,
): T {
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      let instance = globalForPrisma[cacheKey] as T | undefined;
      if (!instance) {
        const fallback = fallbackEnv ? process.env[fallbackEnv] : undefined;
        instance = factory(getEnv(envName, fallback));
        if (process.env.NODE_ENV !== "production") {
          (globalForPrisma as Record<string, unknown>)[cacheKey] = instance;
        }
      }
      const value = Reflect.get(instance, prop, receiver);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  });
}

// ─── prismaMaster (lazy) ─────────────────────────────────────────────────────
// Compat de Fase 2: si MASTER_DATABASE_URL no está, cae a DATABASE_URL.
// Fase 8 (cutover) introduce MASTER_DATABASE_URL en Dokploy y la legacy
// DATABASE_URL se elimina (ADR-005 §2.3.a).
export const prismaMaster: PrismaClientMaster = lazyClient(
  "MASTER_DATABASE_URL",
  "prismaMaster",
  createMasterClient,
  "DATABASE_URL",
);

// ─── prismaApp (multiplexado por tenant) ─────────────────────────────────────
// Un cliente Prisma por tenant, cacheado en globalThis._tenantClients.
// El Proxy invoca currentTenant() en cada acceso y devuelve el cliente
// correspondiente. Lanza si no hay tenant en contexto.
export const prismaApp: PrismaClientTenant = buildPrismaAppProxy();

// ─── prismaRuntime (lazy) ────────────────────────────────────────────────────
// Read-only sobre 4 tablas master. Usado por middleware HTTP, hasFeature,
// getLimit, GET /api/me/features.
export const prismaRuntime: PrismaClientMaster = lazyClient(
  "TENANT_RUNTIME_DATABASE_URL",
  "prismaRuntime",
  createMasterClient,
);

// ─── prismaQuotaWriter (lazy) ────────────────────────────────────────────────
// **Solo** importar desde src/lib/tenant/features.ts (ADR-004 §2.2).
// La regla ESLint no-quota-writer-leak (Fase 5) vigila el uso indebido.
export const prismaQuotaWriter: PrismaClientMaster = lazyClient(
  "QUOTA_WRITER_DATABASE_URL",
  "prismaQuotaWriter",
  createMasterClient,
);

// El alias `prisma = prismaMaster` (compat de Fase 0.5) se eliminó en el
// commit 22 cuando los 50 importadores migraron a prismaApp/prismaMaster
// según contexto (ADR-002 §2.2 + §15.4 del plan).
