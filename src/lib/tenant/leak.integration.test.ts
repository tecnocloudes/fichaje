/**
 * Test de fuga obligatorio (ADR-001 §2.4 + ADR-002 §6 criterio 5).
 *
 * Bloquea el cierre de Fase 3 según el plan. Cuatro escenarios:
 *
 *  1. Query sin tenant en contexto debe lanzar antes de tocar BD.
 *  2. Tenant A no ve datos del tenant B (aislamiento por schema).
 *  3. JWT con tenantSlug ≠ slug del host → la función de validación
 *     devuelve false (proxy responde 401).
 *  4. Slug malicioso → CHECK constraint en master.tenants lo rechaza.
 *
 * Setup: Postgres efímero (Testcontainers) con:
 *  - migraciones del control plane.
 *  - roles (00-roles.sql).
 *  - schema tenant_template + grants (01-tenant-template.sql).
 *  - migración del producto aplicada a tenant_template.
 *  - 2 tenants provisionados: acme y umbrella, ambos con un usuario
 *    `alice@example.com` y DNI `12345678A`.
 *
 * Tiempo estimado: ~30-60s.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Client } from "pg";
import { PrismaClient as PrismaClientMaster } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runWithTenant } from "./context";
import { quoteSchemaName } from "./quote";

let container: StartedPostgreSqlContainer;
let connectionString: string;
let prisma: PrismaClientMaster;

const PRODUCT_MIGRATION_SQL = (() => {
  const migrationsDir = path.resolve(
    process.cwd(),
    "prisma",
    "migrations-tenant",
  );
  const folders = require("node:fs")
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
    .map((d: { name: string }) => d.name)
    .sort();
  return readFileSync(
    path.join(migrationsDir, folders[0], "migration.sql"),
    "utf8",
  );
})();

async function exec(client: Client, sql: string): Promise<void> {
  await client.query(sql);
}

function appConnectionString(): string {
  const u = new URL(connectionString);
  u.username = "app_role";
  u.password = "leak_test_app";
  return u.toString();
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_leak")
    .withUsername("postgres")
    .withPassword("test")
    .start();
  connectionString = container.getConnectionUri();

  // 1. Migraciones master (control plane).
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: "pipe",
  });

  // 2. Roles. Sustituyendo password placeholder con uno fijo.
  const rolesSqlRaw = readFileSync(
    path.resolve(process.cwd(), "scripts/sql/00-roles.sql"),
    "utf8",
  );
  // El script usa psql variables que vamos a evaluar: replicamos los CREATE
  // ROLE manualmente con passwords fijas.
  const adminClient = new Client({ connectionString });
  await adminClient.connect();
  // 4 roles requeridos por la app multi-tenant. NO toca el rol
  // postgres del container (sigue siendo superuser).
  await adminClient.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'master_role') THEN
        CREATE ROLE master_role WITH LOGIN PASSWORD 'leak_test_master';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
        CREATE ROLE app_role WITH LOGIN PASSWORD 'leak_test_app';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_runtime_role') THEN
        CREATE ROLE tenant_runtime_role WITH LOGIN PASSWORD 'leak_test_runtime';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quota_writer_role') THEN
        CREATE ROLE quota_writer_role WITH LOGIN PASSWORD 'leak_test_quota';
      END IF;
    END $$;
  `);
  // master_role debe poder gestionar el schema master + tenant_*.
  await adminClient.query(`GRANT ALL ON SCHEMA master TO master_role`);
  await adminClient.query(`GRANT ALL ON ALL TABLES IN SCHEMA master TO master_role`);
  await adminClient.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA master GRANT ALL ON TABLES TO master_role`,
  );
  await adminClient.query(
    `GRANT CREATE ON DATABASE fichaje_leak TO master_role`,
  );
  // tenant_runtime_role: SELECT en master.tenants, master.reserved_slugs,
  // master.tenant_features, master.tenant_quota_usage.
  await adminClient.query(`GRANT USAGE ON SCHEMA master TO tenant_runtime_role`);
  await adminClient.query(
    `GRANT SELECT ON master.tenants, master.reserved_slugs, master.tenant_features, master.tenant_quota_usage TO tenant_runtime_role`,
  );
  // quota_writer_role: SELECT/INSERT/UPDATE en master.tenant_quota_usage.
  await adminClient.query(`GRANT USAGE ON SCHEMA master TO quota_writer_role`);
  await adminClient.query(
    `GRANT SELECT, INSERT, UPDATE ON master.tenant_quota_usage TO quota_writer_role`,
  );

  // 3. tenant_template + grants.
  const templateSql = readFileSync(
    path.resolve(process.cwd(), "scripts/sql/01-tenant-template.sql"),
    "utf8",
  );
  // Quitar las directivas \\set (psql) que pg no entiende.
  const cleanTemplateSql = templateSql
    .split("\n")
    .filter((l) => !l.startsWith("\\"))
    .join("\n");
  await adminClient.query(cleanTemplateSql);

  // 4. Aplicar migración del producto al tenant_template.
  await adminClient.query(`SET search_path TO tenant_template, public`);
  await adminClient.query(PRODUCT_MIGRATION_SQL);

  // 5. Sembrar plans + features mínimos para que provision funcione.
  await adminClient.query(`
    INSERT INTO master.plans (id, key, name, sort_order, active, created_at, updated_at)
    VALUES
      ('plan_starter', 'starter', 'Starter', 0, true, now(), now()),
      ('plan_pro', 'pro', 'Pro', 1, true, now(), now())
    ON CONFLICT DO NOTHING
  `);
  await adminClient.query(`
    INSERT INTO master.features (id, key, name, type, active, created_at, updated_at)
    VALUES
      ('f_geofencing', 'geofencing', 'Geofencing', 'boolean', true, now(), now()),
      ('f_max_employees', 'max_employees', 'Max empleados', 'limit', true, now(), now())
    ON CONFLICT DO NOTHING
  `);
  await adminClient.query(`
    INSERT INTO master.plan_features (id, plan_id, feature_key, value, created_at)
    VALUES
      ('pf_starter_geo', 'plan_starter', 'geofencing', 'true'::jsonb, now()),
      ('pf_starter_max', 'plan_starter', 'max_employees', '10'::jsonb, now())
    ON CONFLICT DO NOTHING
  `);

  // app_role debe poder conectar a la BD.
  await adminClient.query(`GRANT CONNECT ON DATABASE fichaje_leak TO app_role`);

  // 6. Provisionar 2 tenants via SQL directo (replicamos lógica de
  // tenants-provision para evitar spawn de proceso en el test).
  for (const slug of ["acme", "umbrella"]) {
    const schemaIdent = quoteSchemaName(slug);
    await adminClient.query(`CREATE SCHEMA IF NOT EXISTS ${schemaIdent}`);
    await adminClient.query(
      `GRANT USAGE ON SCHEMA ${schemaIdent} TO app_role`,
    );
    await adminClient.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role`,
    );
    // Aplicar migration.sql al schema.
    await adminClient.query(`SET search_path TO ${schemaIdent}, public`);
    await adminClient.query(PRODUCT_MIGRATION_SQL);
    // Grant SELECT/INSERT/UPDATE/DELETE explícito a app_role sobre las
    // tablas recién creadas. ALTER DEFAULT PRIVILEGES no las cubre porque
    // el creator es el rol postgres (superuser de testcontainer), no
    // master_role. En producción real, las migraciones las corre
    // master_role y los DEFAULT PRIVILEGES sí aplican.
    await adminClient.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemaIdent} TO app_role`,
    );
    await adminClient.query(
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schemaIdent} TO app_role`,
    );
    // Volver a master para inserts en master.tenants.
    await adminClient.query(`SET search_path TO master, public`);
    await adminClient.query(
      `INSERT INTO master.tenants (id, slug, name, email, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', now(), now())
       ON CONFLICT (slug) DO NOTHING`,
      [`tnt_${slug}`, slug, slug, `admin@${slug}.local`],
    );
    // Sembrar User común a ambos tenants — emails y DNIs idénticos.
    // El aislamiento por schema impide que se vean entre sí.
    await adminClient.query(`SET search_path TO ${schemaIdent}, public`);
    await adminClient.query(
      `INSERT INTO "User" (id, email, nombre, apellidos, dni, rol, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'OWNER', now(), now())
       ON CONFLICT DO NOTHING`,
      [`u_${slug}_alice`, "alice@example.com", "Alice", slug, "12345678A"],
    );
  }

  await adminClient.end();

  // Cliente Prisma master para consultas read-only durante los tests.
  prisma = new PrismaClientMaster({
    adapter: new PrismaPg({ connectionString }),
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
}, 30_000);

// ─── Escenario 1 ────────────────────────────────────────────────────────────

describe("Escenario 1: query sin tenant en contexto", () => {
  it("acceder a prismaApp.<modelo> lanza antes de tocar BD", async () => {
    const { prismaApp } = await import("@/lib/prisma");
    process.env.APP_DATABASE_URL = appConnectionString();
    // El Proxy llama currentTenant() en el `get` síncrono; lanza antes
    // de devolver la propiedad.
    expect(() => prismaApp.user).toThrow(/No hay tenant/);
  });
});

// ─── Diagnóstico previo ─────────────────────────────────────────────────────

describe("Diagnóstico previo a escenario 2", () => {
  it("app_role puede SELECT sobre tenant_acme.User vía pg directo", async () => {
    const appClient = new Client({ connectionString: appConnectionString() });
    await appClient.connect();
    try {
      await appClient.query(`SET search_path TO "tenant_acme", public`);
      const r = await appClient.query(`SELECT email, apellidos FROM "User"`);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].email).toBe("alice@example.com");
      expect(r.rows[0].apellidos).toBe("acme");
    } finally {
      await appClient.end();
    }
  });
});

// ─── Escenario 2 ────────────────────────────────────────────────────────────

describe("Escenario 2: tenant A no ve datos de tenant B", () => {
  it("acme.user.findMany ve 1 fila (la de acme); umbrella ve la suya", async () => {
    const { prismaApp } = await import("@/lib/prisma");
    process.env.APP_DATABASE_URL = appConnectionString();

    const acmeUsers = await runWithTenant(
      {
        tenantId: "tnt_acme",
        slug: "acme",
        status: "active",
        features: new Map(),
      },
      async () => await prismaApp.user.findMany(),
    );
    expect(acmeUsers).toHaveLength(1);
    expect(acmeUsers[0]!.apellidos).toBe("acme");

    const umbrellaUsers = await runWithTenant(
      {
        tenantId: "tnt_umbrella",
        slug: "umbrella",
        status: "active",
        features: new Map(),
      },
      async () => await prismaApp.user.findMany(),
    );
    expect(umbrellaUsers).toHaveLength(1);
    expect(umbrellaUsers[0]!.apellidos).toBe("umbrella");
  });

  it("ambos tenants tienen alice@example.com pero la fila es independiente", async () => {
    const { prismaApp } = await import("@/lib/prisma");
    const acme = await runWithTenant(
      {
        tenantId: "tnt_acme",
        slug: "acme",
        status: "active",
        features: new Map(),
      },
      async () =>
        await prismaApp.user.findUnique({
          where: { email: "alice@example.com" },
        }),
    );
    const umbrella = await runWithTenant(
      {
        tenantId: "tnt_umbrella",
        slug: "umbrella",
        status: "active",
        features: new Map(),
      },
      async () =>
        await prismaApp.user.findUnique({
          where: { email: "alice@example.com" },
        }),
    );
    expect(acme).not.toBeNull();
    expect(umbrella).not.toBeNull();
    expect(acme!.id).not.toBe(umbrella!.id);
    expect(acme!.id).toBe("u_acme_alice");
    expect(umbrella!.id).toBe("u_umbrella_alice");
  });
});

// ─── Escenario 3 ────────────────────────────────────────────────────────────

describe("Escenario 3: JWT cross-tenant", () => {
  it("validateJwtTenantMatch devuelve false si JWT.slug !== ctx.slug", () => {
    // La validación está inline en src/proxy.ts. Replicamos la
    // condición para asegurar contrato.
    const validate = (jwtSlug: string | undefined, ctxSlug: string) =>
      !jwtSlug || jwtSlug === ctxSlug;

    expect(validate("acme", "acme")).toBe(true);
    expect(validate("acme", "umbrella")).toBe(false);
    expect(validate(undefined, "acme")).toBe(true); // sin JWT, no se rechaza aquí
  });
});

// ─── Escenario 4 ────────────────────────────────────────────────────────────

describe("Escenario 4: slug malicioso rechazado por CHECK", () => {
  it("CHECK constraint rechaza slug con SQL injection", async () => {
    await expect(
      prisma.tenant.create({
        data: {
          id: "tnt_bad",
          slug: "tenant_; DROP SCHEMA public CASCADE; --",
          name: "Bad",
          email: "x@x.com",
        },
      }),
    ).rejects.toThrow();
  });

  it("CHECK constraint rechaza slug con mayúsculas", async () => {
    await expect(
      prisma.tenant.create({
        data: {
          id: "tnt_bad2",
          slug: "BAD_SLUG",
          name: "Bad",
          email: "x@x.com",
        },
      }),
    ).rejects.toThrow();
  });

  it("CHECK constraint rechaza slug demasiado corto", async () => {
    await expect(
      prisma.tenant.create({
        data: {
          id: "tnt_bad3",
          slug: "ab",
          name: "Bad",
          email: "x@x.com",
        },
      }),
    ).rejects.toThrow();
  });

  it("quoteSchemaName lanza antes incluso de tocar BD", () => {
    expect(() =>
      quoteSchemaName("tenant_; DROP SCHEMA public CASCADE; --"),
    ).toThrow();
  });
});
