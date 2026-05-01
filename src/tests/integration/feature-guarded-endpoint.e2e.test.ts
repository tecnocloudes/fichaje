/**
 * E2E preventivo de un endpoint feature-gated SIN mocks de la cadena
 * feature-guard. Detecta bugs como FIX 1 (catálogo no cargado) y
 * FIX 2 (quota no rotada) antes de llegar a Fase 6+.
 *
 * Cubre /api/empleados POST con `max_employees` (limit + advisory
 * lock + getLimit + ensureFeatureCatalogLoaded). El fichero exportar
 * informes lo cubrió la verificación manual del operador (depende de
 * fetch interno, complicado de aislar en test).
 *
 * Setup: Testcontainers + roles reales + tenant_template + tenant
 * provisionado + tenant_features (max_employees=2).
 *
 * Verifica:
 *  1. Sin llamar _setFeatureCatalogForTest, withTenant carga el
 *     catálogo y `getLimit('max_employees')` no lanza.
 *  2. Primer POST → 201 (consumed=1, max=2).
 *  3. Segundo POST → 201 (consumed=2, saturado).
 *  4. Tercer POST → 402 con shape limit_reached + upgrade_url.
 *
 * El test NO siembra _featureCatalog: confía en
 * ensureFeatureCatalogLoaded llamado por withTenant.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Client } from "pg";
import { quoteSchemaName } from "@/lib/tenant/quote";

let container: StartedPostgreSqlContainer;
let connectionString: string;

const PRODUCT_MIGRATION_SQL = (() => {
  const migrationsDir = path.resolve(
    process.cwd(),
    "prisma",
    "migrations-tenant",
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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

// Mock auth(): devuelve un OWNER consistente para todos los requests.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "u_e2e_owner", rol: "OWNER", tiendaId: null, name: "Owner E2E" },
  }),
}));

// El handler resuelve el host del request via headers; mockeamos
// solo getToken para que JWT cross-validation no rechace.
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn().mockResolvedValue(null),
}));

// Mock de notificaciones e2e: el POST /api/empleados intenta enviar
// email de invitación. Mockeamos el SMTP para no salir a la red.
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_e2e")
    .withUsername("postgres")
    .withPassword("test")
    .start();
  connectionString = container.getConnectionUri();

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: "pipe",
  });

  const adminClient = new Client({ connectionString });
  await adminClient.connect();
  // Roles requeridos.
  await adminClient.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
        CREATE ROLE app_role WITH LOGIN PASSWORD 'e2e_app';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_runtime_role') THEN
        CREATE ROLE tenant_runtime_role WITH LOGIN PASSWORD 'e2e_runtime';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quota_writer_role') THEN
        CREATE ROLE quota_writer_role WITH LOGIN PASSWORD 'e2e_quota';
      END IF;
    END $$;
  `);
  await adminClient.query(`GRANT USAGE ON SCHEMA master TO tenant_runtime_role`);
  await adminClient.query(
    `GRANT SELECT ON master.tenants, master.reserved_slugs, master.tenant_features, master.tenant_quota_usage TO tenant_runtime_role`,
  );
  await adminClient.query(`GRANT USAGE ON SCHEMA master TO quota_writer_role`);
  await adminClient.query(
    `GRANT SELECT, INSERT, UPDATE ON master.tenant_quota_usage TO quota_writer_role`,
  );
  await adminClient.query(`GRANT CONNECT ON DATABASE fichaje_e2e TO app_role`);

  // Catálogo de features (subset suficiente para el test).
  await adminClient.query(`
    INSERT INTO master.features (id, key, name, type, quota_period, active, created_at, updated_at)
    VALUES
      ('f_max_emp', 'max_employees', 'Max empleados', 'limit', NULL, true, now(), now())
    ON CONFLICT DO NOTHING
  `);

  // Provisionar schema tenant + migration + grants para app_role.
  const slug = "e2e";
  const schema = quoteSchemaName(slug);
  await adminClient.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await adminClient.query(`GRANT USAGE ON SCHEMA ${schema} TO app_role`);
  await adminClient.query(`SET search_path TO ${schema}, public`);
  await adminClient.query(PRODUCT_MIGRATION_SQL);
  await adminClient.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO app_role`,
  );
  await adminClient.query(
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO app_role`,
  );

  // Tenant + tenant_features con max_employees=2.
  await adminClient.query(`SET search_path TO master, public`);
  await adminClient.query(
    `INSERT INTO master.tenants (id, slug, name, email, status, created_at, updated_at)
     VALUES ('tnt_e2e', 'e2e', 'E2E', 'admin@e2e.local', 'active', now(), now())
     ON CONFLICT DO NOTHING`,
  );
  await adminClient.query(`
    INSERT INTO master.tenant_features
      (id, tenant_id, feature_key, value, source, created_at, updated_at)
    VALUES
      ('tf_e2e_max', 'tnt_e2e', 'max_employees', '2'::jsonb, 'plan', now(), now())
    ON CONFLICT DO NOTHING
  `);
  await adminClient.end();

  // Configurar URLs por rol.
  const buildUrl = (user: string, pass: string) => {
    const u = new URL(connectionString);
    u.username = user;
    u.password = pass;
    return u.toString();
  };
  process.env.MASTER_DATABASE_URL = connectionString;
  process.env.APP_DATABASE_URL = buildUrl("app_role", "e2e_app");
  process.env.TENANT_RUNTIME_DATABASE_URL = buildUrl(
    "tenant_runtime_role",
    "e2e_runtime",
  );
  process.env.QUOTA_WRITER_DATABASE_URL = buildUrl(
    "quota_writer_role",
    "e2e_quota",
  );
  delete (globalThis as Record<string, unknown>).prismaMaster;
  delete (globalThis as Record<string, unknown>).prismaRuntime;
  delete (globalThis as Record<string, unknown>).prismaQuotaWriter;
  delete (globalThis as Record<string, unknown>).prismaApp;
  delete (globalThis as Record<string, unknown>)._tenantClients;
}, 240_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

async function postEmpleado(email: string, nombre: string): Promise<Response> {
  const { POST } = await import("@/app/api/empleados/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://e2e.localhost:3000/api/empleados", {
    method: "POST",
    headers: {
      host: "e2e.localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, nombre, apellidos: "Test", rol: "EMPLEADO" }),
  });
  return POST(req);
}

describe("E2E feature-guarded endpoint /api/empleados POST", () => {
  it("primer POST con max_employees=2 → 201 (catálogo carga sin mocks)", async () => {
    const res = await postEmpleado("alice@e2e.local", "Alice");
    expect(res.status).toBe(201);
  });

  it("segundo POST → 201 (saturando el límite)", async () => {
    const res = await postEmpleado("bob@e2e.local", "Bob");
    expect(res.status).toBe(201);
  });

  it("tercer POST → 402 limit_reached con shape correcto", async () => {
    const res = await postEmpleado("charlie@e2e.local", "Charlie");
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      error?: string;
      feature_key?: string;
      current?: number;
      max?: number;
      upgrade_url?: string;
    };
    expect(body.error).toBe("limit_reached");
    expect(body.feature_key).toBe("max_employees");
    expect(body.current).toBe(2);
    expect(body.max).toBe(2);
    expect(body.upgrade_url).toContain("upgrade=max_employees");
  });
});
