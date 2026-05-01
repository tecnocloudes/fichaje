/**
 * E2E de /api/informes/exportar con BD real.
 *
 * Detecta el bug FIX 3 (fetch interno frágil con ECONNREFUSED) si
 * volviera a aparecer: este test invoca el handler directamente
 * y verifica que devuelve un buffer PDF/Excel/CSV válido sin red.
 *
 * Setup: Testcontainers + tenant con feature export_pdf=true +
 * exports_mes max=5 + algunos fichajes sembrados.
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

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "u_export_owner", rol: "OWNER", tiendaId: null, name: "Owner" },
  }),
}));

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn().mockResolvedValue(null),
}));

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_export")
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
  await adminClient.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
        CREATE ROLE app_role WITH LOGIN PASSWORD 'exp_app';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_runtime_role') THEN
        CREATE ROLE tenant_runtime_role WITH LOGIN PASSWORD 'exp_runtime';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quota_writer_role') THEN
        CREATE ROLE quota_writer_role WITH LOGIN PASSWORD 'exp_quota';
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
  await adminClient.query(`GRANT CONNECT ON DATABASE fichaje_export TO app_role`);

  // Catálogo de features.
  await adminClient.query(`
    INSERT INTO master.features (id, key, name, type, quota_period, active, created_at, updated_at)
    VALUES
      ('f_exp_pdf', 'export_pdf', 'Export PDF', 'boolean', NULL, true, now(), now()),
      ('f_exp_csv', 'export_csv', 'Export CSV', 'boolean', NULL, true, now(), now()),
      ('f_exp_quota', 'exports_mes', 'Exports/mes', 'quota', 'mes', true, now(), now())
    ON CONFLICT DO NOTHING
  `);

  // Schema tenant_export + migración del producto.
  const slug = "export";
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

  // Tenant + features asignadas + 1 user OWNER + 1 tienda + 2 fichajes.
  await adminClient.query(`SET search_path TO master, public`);
  await adminClient.query(
    `INSERT INTO master.tenants (id, slug, name, email, status, created_at, updated_at)
     VALUES ('tnt_export', 'export', 'Export', 'admin@export.local', 'active', now(), now())
     ON CONFLICT DO NOTHING`,
  );
  await adminClient.query(`
    INSERT INTO master.tenant_features
      (id, tenant_id, feature_key, value, source, created_at, updated_at)
    VALUES
      ('tf_exp_pdf', 'tnt_export', 'export_pdf', 'true'::jsonb, 'plan', now(), now()),
      ('tf_exp_csv', 'tnt_export', 'export_csv', 'true'::jsonb, 'plan', now(), now()),
      ('tf_exp_quota', 'tnt_export', 'exports_mes', '5'::jsonb, 'plan', now(), now())
    ON CONFLICT DO NOTHING
  `);
  await adminClient.query(`SET search_path TO ${schema}, public`);
  await adminClient.query(
    `INSERT INTO "User" (id, email, nombre, apellidos, dni, rol, "createdAt", "updatedAt")
     VALUES ('u_export_owner', 'owner@export.local', 'Owner', 'Test', '99999999A', 'OWNER', now(), now())
     ON CONFLICT DO NOTHING`,
  );
  await adminClient.query(
    `INSERT INTO "Tienda" (id, nombre, direccion, ciudad, "createdAt", "updatedAt")
     VALUES ('t_export', 'Sede Centro', 'Calle 1', 'Madrid', now(), now())
     ON CONFLICT DO NOTHING`,
  );
  await adminClient.query(
    `INSERT INTO "Fichaje" (id, "userId", "tiendaId", tipo, timestamp, metodo, "createdAt")
     VALUES
       ('fic1', 'u_export_owner', 't_export', 'ENTRADA', '2026-04-15T08:00:00Z', 'WEB', now()),
       ('fic2', 'u_export_owner', 't_export', 'SALIDA',  '2026-04-15T17:00:00Z', 'WEB', now())
     ON CONFLICT DO NOTHING`,
  );
  await adminClient.end();

  const buildUrl = (user: string, pass: string) => {
    const u = new URL(connectionString);
    u.username = user;
    u.password = pass;
    return u.toString();
  };
  process.env.MASTER_DATABASE_URL = connectionString;
  process.env.APP_DATABASE_URL = buildUrl("app_role", "exp_app");
  process.env.TENANT_RUNTIME_DATABASE_URL = buildUrl(
    "tenant_runtime_role",
    "exp_runtime",
  );
  process.env.QUOTA_WRITER_DATABASE_URL = buildUrl(
    "quota_writer_role",
    "exp_quota",
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

async function callExportar(formato: "csv" | "pdf"): Promise<Response> {
  const { GET } = await import("@/app/api/informes/exportar/route");
  const { NextRequest } = await import("next/server");
  const url = `http://export.localhost:3000/api/informes/exportar?formato=${formato}&tipo=fichajes&fechaInicio=2026-04-01&fechaFin=2026-04-30`;
  const req = new NextRequest(url, {
    headers: { host: "export.localhost:3000" },
  });
  return GET(req);
}

describe("E2E /api/informes/exportar — sin fetch interno", () => {
  it("PDF devuelve 200 con buffer válido (%PDF magic bytes)", async () => {
    const res = await callExportar("pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(100);
    // Magic bytes %PDF
    expect(buf[0]).toBe(0x25);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x44);
    expect(buf[3]).toBe(0x46);
  });

  it("CSV devuelve 200 con BOM UTF-8 + datos reales", async () => {
    const res = await callExportar("csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    // Leer como bytes para verificar el BOM (text() puede normalizarlo).
    const buf = Buffer.from(await res.arrayBuffer());
    // BOM UTF-8: EF BB BF.
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
    const text = buf.toString("utf8");
    // El CSV debe incluir las filas de fichajes sembradas.
    expect(text).toContain("ENTRADA");
    expect(text).toContain("SALIDA");
  });

  it("quota incrementa en BD tras export (consumed=2 tras 2 calls)", async () => {
    const verify = new Client({ connectionString });
    await verify.connect();
    const r = await verify.query<{ consumed: string }>(
      `SELECT consumed FROM master.tenant_quota_usage
        WHERE tenant_id=$1 AND feature_key=$2`,
      ["tnt_export", "exports_mes"],
    );
    await verify.end();
    // 2 exports anteriores (PDF + CSV). UPSERT crea fila en período actual.
    expect(r.rows.length).toBeGreaterThan(0);
    expect(Number(r.rows[0]!.consumed)).toBeGreaterThanOrEqual(2);
  });
});
