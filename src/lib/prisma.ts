/**
 * Cuatro clientes Prisma con roles Postgres distintos.
 *
 * - `prismaMaster`     → master_role: control plane completo. Migraciones,
 *                         seeds, worker (Fase 4), panel super-admin (Fase 7).
 *                         Cliente generado: src/generated/prisma (master).
 * - `prismaApp`        → app_role: schemas tenant_<slug>. Lo usa el código
 *                         del producto tras `SET search_path` por query
 *                         (ADR-002 §2.2). Cliente generado:
 *                         src/generated/prisma-tenant. El SET search_path
 *                         se aplica vía $extends en commit 6.
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

function createTenantClient(connectionString: string): PrismaClientTenant {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClientTenant({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
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

// ─── prismaApp (lazy, cliente del producto) ──────────────────────────────────
// Usado por el producto tras SET search_path al schema del tenant. El
// $extends que aplica search_path se añade en commit 6.
export const prismaApp: PrismaClientTenant = lazyClient(
  "APP_DATABASE_URL",
  "prismaApp",
  createTenantClient,
);

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

// ─── Compat con Fase 0.5 ─────────────────────────────────────────────────────
// Alias `prisma` apuntando a prismaMaster. El código legacy del producto
// (50 endpoints en src/app/api/*) sigue importando esto. Los commits 19-21
// migran cada endpoint a `prismaApp`. El commit 22 final retira este alias
// y los modelos del producto de schema.prisma.
//
// NOTA — desviación menor del plan: §15.4 propuso eliminar este alias en el
// commit 3, pero como prismaApp depende de runWithTenant + $extends (commits
// 4-6) y el refactor de endpoints requiere el lint rule (commit 18), eliminar
// el alias antes rompería tsc en 50 archivos sin beneficio. Se mantiene como
// compat hasta el commit 22 final.
export const prisma = prismaMaster;
