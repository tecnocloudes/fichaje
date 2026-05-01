/**
 * E2E /api/festivos CRUD con BD real.
 * Plan Fase 6 §3.2 + §7.
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
  return folders
    .map((f: string) =>
      readFileSync(path.join(migrationsDir, f, "migration.sql"), "utf8"),
    )
    .join("\n");
})();

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn().mockResolvedValue(null),
}));

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_fest")
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
        CREATE ROLE app_role WITH LOGIN PASSWORD 'fest_app';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tenant_runtime_role') THEN
        CREATE ROLE tenant_runtime_role WITH LOGIN PASSWORD 'fest_runtime';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='quota_writer_role') THEN
        CREATE ROLE quota_writer_role WITH LOGIN PASSWORD 'fest_quota';
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
  await adminClient.query(`GRANT CONNECT ON DATABASE fichaje_fest TO app_role`);

  const slug = "fest";
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
     VALUES ('tnt_fest', 'fest', 'Fest', 'admin@fest.local', 'active', now(), now())
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
  process.env.APP_DATABASE_URL = buildUrl("app_role", "fest_app");
  process.env.TENANT_RUNTIME_DATABASE_URL = buildUrl(
    "tenant_runtime_role",
    "fest_runtime",
  );
  process.env.QUOTA_WRITER_DATABASE_URL = buildUrl(
    "quota_writer_role",
    "fest_quota",
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

async function callGET(): Promise<Response> {
  const { GET } = await import("@/app/api/festivos/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://fest.localhost:3000/api/festivos", {
    headers: { host: "fest.localhost:3000" },
  });
  return GET(req);
}

async function callPOST(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/festivos/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://fest.localhost:3000/api/festivos", {
    method: "POST",
    headers: { host: "fest.localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

async function callDELETE(id: string): Promise<Response> {
  const { DELETE } = await import("@/app/api/festivos/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(
    `http://fest.localhost:3000/api/festivos?id=${id}`,
    {
      method: "DELETE",
      headers: { host: "fest.localhost:3000" },
    },
  );
  return DELETE(req);
}

describe("E2E /api/festivos CRUD", () => {
  it("GET sin auth → 401", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const res = await callGET();
    expect(res.status).toBe(401);
  });

  it("POST como EMPLEADO → 403", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u_emp", rol: "EMPLEADO", name: "Emp" },
    } as never);
    const res = await callPOST({ nombre: "Día x", fecha: "2026-12-25" });
    expect(res.status).toBe(403);
  });

  it("POST como OWNER → 201 y aparece en GET", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u_own", rol: "OWNER", name: "Own" },
    } as never);
    const res = await callPOST({
      nombre: "Navidad",
      fecha: "2026-12-25",
      ambito: "nacional",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { festivo: { id: string; nombre: string } };
    expect(body.festivo.nombre).toBe("Navidad");

    const list = await callGET();
    const listBody = (await list.json()) as { festivos: { id: string }[] };
    expect(listBody.festivos.length).toBeGreaterThan(0);
  });

  it("POST con fecha inválida → 400 fecha_invalid", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u_own", rol: "OWNER", name: "Own" },
    } as never);
    const res = await callPOST({ nombre: "X", fecha: "not-a-date" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("fecha_invalid");
  });

  it("DELETE como OWNER elimina el festivo", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u_own", rol: "OWNER", name: "Own" },
    } as never);
    const created = await callPOST({ nombre: "Borrable", fecha: "2026-08-15" });
    const createdBody = (await created.json()) as { festivo: { id: string } };
    const del = await callDELETE(createdBody.festivo.id);
    expect(del.status).toBe(200);
  });
});
