/**
 * E2E custom domain — Plan Fase 6 §7.
 *
 * Cubre flow completo:
 *  1. POST /api/configuracion/dominio registra el dominio + genera token.
 *  2. POST /verify falla si TXT no presente.
 *  3. POST /verify pasa cuando TXT contiene el token (mockeamos DNS).
 *  4. resolveTenant resuelve el host custom solo con feature ON.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
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
  return folders
    .map((f: string) =>
      readFileSync(path.join(migrationsDir, f, "migration.sql"), "utf8"),
    )
    .join("\n");
})();

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "u_dom_owner", rol: "OWNER", name: "Owner" },
  }),
}));
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/tenant/dns", () => ({
  resolveTxtWithTimeout: vi.fn(),
}));

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_dom")
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
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_role') THEN
        CREATE ROLE app_role WITH LOGIN PASSWORD 'dom_app';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tenant_runtime_role') THEN
        CREATE ROLE tenant_runtime_role WITH LOGIN PASSWORD 'dom_runtime';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='quota_writer_role') THEN
        CREATE ROLE quota_writer_role WITH LOGIN PASSWORD 'dom_quota';
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
  await adminClient.query(`GRANT CONNECT ON DATABASE fichaje_dom TO app_role`);

  await adminClient.query(`
    INSERT INTO master.features (id, key, name, type, active, created_at, updated_at)
    VALUES ('f_dom', 'dominio_personalizado', 'Custom Domain', 'boolean', true, now(), now())
    ON CONFLICT DO NOTHING
  `);

  const slug = "dom";
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

  await adminClient.query(`SET search_path TO master, public`);
  await adminClient.query(
    `INSERT INTO master.tenants (id, slug, name, email, status, created_at, updated_at)
     VALUES ('tnt_dom', 'dom', 'Dom', 'admin@dom.local', 'active', now(), now())
     ON CONFLICT DO NOTHING`,
  );
  // Activar feature dominio_personalizado.
  await adminClient.query(`
    INSERT INTO master.tenant_features
      (id, tenant_id, feature_key, value, source, created_at, updated_at)
    VALUES
      ('tf_dom_active', 'tnt_dom', 'dominio_personalizado', 'true'::jsonb, 'addon', now(), now())
    ON CONFLICT DO NOTHING
  `);
  await adminClient.end();

  const buildUrl = (user: string, pass: string) => {
    const u = new URL(connectionString);
    u.username = user;
    u.password = pass;
    return u.toString();
  };
  process.env.MASTER_DATABASE_URL = connectionString;
  process.env.APP_DATABASE_URL = buildUrl("app_role", "dom_app");
  process.env.TENANT_RUNTIME_DATABASE_URL = buildUrl("tenant_runtime_role", "dom_runtime");
  process.env.QUOTA_WRITER_DATABASE_URL = buildUrl("quota_writer_role", "dom_quota");
  delete (globalThis as Record<string, unknown>).prismaMaster;
  delete (globalThis as Record<string, unknown>).prismaRuntime;
  delete (globalThis as Record<string, unknown>).prismaQuotaWriter;
  delete (globalThis as Record<string, unknown>).prismaApp;
  delete (globalThis as Record<string, unknown>)._tenantClients;
}, 240_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

beforeEach(() => {
  vi.clearAllMocks();
});

async function callPOST(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/configuracion/dominio/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://dom.localhost:3000/api/configuracion/dominio", {
    method: "POST",
    headers: { host: "dom.localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

async function callVerify(): Promise<Response> {
  const { POST } = await import("@/app/api/configuracion/dominio/verify/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(
    "http://dom.localhost:3000/api/configuracion/dominio/verify",
    {
      method: "POST",
      headers: { host: "dom.localhost:3000" },
    },
  );
  return POST(req);
}

describe("E2E custom domain", () => {
  it("POST registra dominio + devuelve verifyRecord con TXT", async () => {
    // Primer mock: la sesión OWNER + tenant_features dominio activa.
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u_dom_owner", rol: "OWNER", name: "Owner" },
    } as never);

    const res = await callPOST({ domain: "fichaje.example.com" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      domain: string;
      verified: boolean;
      verifyRecord: { host: string; type: string; value: string };
    };
    expect(body.domain).toBe("fichaje.example.com");
    expect(body.verified).toBe(false);
    expect(body.verifyRecord.host).toBe("_fichaje-verify.fichaje.example.com");
    expect(body.verifyRecord.type).toBe("TXT");
    expect(body.verifyRecord.value).toMatch(/^fichaje-verify=/);
  });

  it("POST con FQDN inválido → 400 domain_invalid", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u_dom_owner", rol: "OWNER", name: "Owner" },
    } as never);
    const res = await callPOST({ domain: "no-es-dominio" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("domain_invalid");
  });

  it("verify falla si TXT no contiene el token", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u_dom_owner", rol: "OWNER", name: "Owner" },
    } as never);
    const { resolveTxtWithTimeout } = await import("@/lib/tenant/dns");
    vi.mocked(resolveTxtWithTimeout).mockResolvedValueOnce([
      ["fichaje-verify=otrotoken"],
    ]);
    const res = await callVerify();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("txt_record_not_found");
  });

  it("verify pasa si TXT contiene token correcto + marca verified=true", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u_dom_owner", rol: "OWNER", name: "Owner" },
    } as never);

    // Leer el token actual de BD.
    const verify = new Client({ connectionString });
    await verify.connect();
    const tok = await verify.query<{ custom_domain_token: string }>(
      `SELECT custom_domain_token FROM master.tenants WHERE id=$1`,
      ["tnt_dom"],
    );
    await verify.end();
    const token = tok.rows[0]!.custom_domain_token;
    expect(token).toBeTruthy();

    const { resolveTxtWithTimeout } = await import("@/lib/tenant/dns");
    vi.mocked(resolveTxtWithTimeout).mockResolvedValueOnce([
      ["fichaje-verify=" + token],
    ]);

    const res = await callVerify();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { domain: string; verified: boolean };
    expect(body.verified).toBe(true);

    // Confirmar en BD.
    const verify2 = new Client({ connectionString });
    await verify2.connect();
    const check = await verify2.query<{ custom_domain_verified: boolean }>(
      `SELECT custom_domain_verified FROM master.tenants WHERE id=$1`,
      ["tnt_dom"],
    );
    await verify2.end();
    expect(check.rows[0]!.custom_domain_verified).toBe(true);
  });
});
