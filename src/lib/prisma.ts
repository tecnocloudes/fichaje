/**
 * Cuatro clientes Prisma con roles Postgres distintos.
 *
 * - `prismaMaster`     → master_role: control plane completo. Migraciones,
 *                         seeds, worker (Fase 4), panel super-admin (Fase 7).
 * - `prismaApp`        → app_role: schemas tenant_<slug>. Lo usa el código
 *                         del producto tras `SET search_path` por query
 *                         (ADR-002 §2.2). Lazy.
 * - `prismaRuntime`    → tenant_runtime_role: SELECT-only sobre 4 tablas
 *                         master. Usado por el middleware HTTP, hasFeature,
 *                         getLimit y GET /api/me/features. Lazy.
 * - `prismaQuotaWriter` → quota_writer_role: SELECT/INSERT/UPDATE solo sobre
 *                         master.tenant_quota_usage. **Solo** lo importa
 *                         consumeQuota (ADR-004 §2.5). Lazy. Vigilado por
 *                         la regla ESLint custom no-quota-writer-leak
 *                         (Fase 5).
 *
 * Diseño:
 * - `prismaMaster` se instancia siempre que el módulo se importa (eager).
 *   En Fase 2 cae a `DATABASE_URL` si `MASTER_DATABASE_URL` no está
 *   definida — compat para desarrollo local sin tocar configuración.
 * - Los 3 clientes restantes son **lazy**: se instancian al primer acceso
 *   con un Proxy. Si la env correspondiente falta cuando se accede,
 *   lanzan con mensaje claro indicando qué env falta. Esto permite que
 *   en Fase 2 la app siga funcionando con `prisma`/`prismaMaster` sin
 *   exigir las nuevas URLs hasta que el código de Fase 3+ las consuma.
 *
 * En desarrollo, los 4 clientes se cachean en `globalThis` para sobrevivir
 * al hot reload de Next.
 */

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

type CachedClients = {
  prismaMaster?: PrismaClient;
  prismaApp?: PrismaClient;
  prismaRuntime?: PrismaClient;
  prismaQuotaWriter?: PrismaClient;
};

const globalForPrisma = globalThis as unknown as CachedClients;

function createClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
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

// ─── prismaMaster (eager) ────────────────────────────────────────────────────
// Compat de Fase 2: si MASTER_DATABASE_URL no está, cae a DATABASE_URL.
// Fase 8 (cutover) introduce MASTER_DATABASE_URL en Dokploy y la legacy
// DATABASE_URL se elimina (ADR-005 §2.3.a).
export const prismaMaster: PrismaClient =
  globalForPrisma.prismaMaster ??
  createClient(getEnv("MASTER_DATABASE_URL", process.env.DATABASE_URL));

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaMaster = prismaMaster;
}

/**
 * Construye un Proxy lazy sobre PrismaClient: instancia el cliente real al
 * primer acceso de propiedad. Si la env falta, lanza al primer uso.
 */
function lazyClient(envName: string, cacheKey: keyof CachedClients): PrismaClient {
  let instance: PrismaClient | undefined = globalForPrisma[cacheKey];

  return new Proxy({} as PrismaClient, {
    get(_target, prop, receiver) {
      if (!instance) {
        instance = createClient(getEnv(envName));
        if (process.env.NODE_ENV !== "production") {
          globalForPrisma[cacheKey] = instance;
        }
      }
      const value = Reflect.get(instance, prop, receiver);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  });
}

// ─── prismaApp (lazy) ────────────────────────────────────────────────────────
// Usado por el producto en runtime tras SET search_path al schema del tenant.
// Materializado en Fase 3.
export const prismaApp: PrismaClient = lazyClient("APP_DATABASE_URL", "prismaApp");

// ─── prismaRuntime (lazy) ────────────────────────────────────────────────────
// Read-only sobre 4 tablas master. Usado por middleware HTTP, hasFeature,
// getLimit, GET /api/me/features. Materializado en Fase 3.
export const prismaRuntime: PrismaClient = lazyClient(
  "TENANT_RUNTIME_DATABASE_URL",
  "prismaRuntime",
);

// ─── prismaQuotaWriter (lazy) ────────────────────────────────────────────────
// **Solo** importar desde src/lib/tenant/features.ts (ADR-004 §2.2).
// La regla ESLint no-quota-writer-leak (Fase 5) vigila el uso indebido.
export const prismaQuotaWriter: PrismaClient = lazyClient(
  "QUOTA_WRITER_DATABASE_URL",
  "prismaQuotaWriter",
);

// ─── Compat con Fase 0.5 ─────────────────────────────────────────────────────
// El código existente importa `prisma` y espera acceso al control plane y al
// producto en `public`. En Fase 2 ambos viven en la misma BD/URL, así que
// este alias funciona. Fase 3 separará el uso: el código del producto pasará
// a usar `prismaApp` y este alias se eliminará.
export const prisma = prismaMaster;
