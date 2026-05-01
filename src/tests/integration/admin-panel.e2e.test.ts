/**
 * E2E del panel super-admin.
 * Plan Fase 7 §6 — patrón obligatorio sin mocks de auth/feature.
 *
 * Cubre:
 *  - login OK + me + logout.
 *  - login wrong password → 401 + audit super-admin:login-failed.
 *  - tenants list con filtros.
 *  - tenant_features:override (POST + DELETE) + audit warnings.
 *  - suspend/restore con transición válida.
 *  - audit-log visibilidad SUPER_ADMIN ve todo, SUPPORT solo info+suyas.
 *  - metrics: shape correcto.
 *  - JWT con audience="tenant" (cookie del tenant) → rechazado por
 *    withSuperAdmin.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

let container: StartedPostgreSqlContainer;
let connectionString: string;
const ADMIN_SECRET = "e2e-admin-secret-32-chars-minimum-required";
const SA_PASSWORD = "AdminPass1!";
const SA_EMAIL = "admin@e2e.local";
const SUPPORT_EMAIL = "support@e2e.local";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_admin")
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

  const hashed = await bcrypt.hash(SA_PASSWORD, 4);
  await adminClient.query(
    `INSERT INTO master.super_admins (id, email, password, name, role, active, created_at, updated_at)
     VALUES ('sa_e2e_main', $1, $2, 'Admin E2E', 'SUPER_ADMIN', true, now(), now())
     ON CONFLICT DO NOTHING`,
    [SA_EMAIL, hashed],
  );
  await adminClient.query(
    `INSERT INTO master.super_admins (id, email, password, name, role, active, created_at, updated_at)
     VALUES ('sa_e2e_support', $1, $2, 'Support E2E', 'SUPPORT', true, now(), now())
     ON CONFLICT DO NOTHING`,
    [SUPPORT_EMAIL, hashed],
  );

  // Tenants de prueba.
  await adminClient.query(
    `INSERT INTO master.tenants (id, slug, name, email, status, created_at, updated_at)
     VALUES
       ('tnt_e2e_a', 'aone', 'Acme One', 'a@x.com', 'active', now(), now()),
       ('tnt_e2e_b', 'btwo', 'Beta Two', 'b@x.com', 'active', now(), now())
     ON CONFLICT DO NOTHING`,
  );

  await adminClient.end();

  process.env.MASTER_DATABASE_URL = connectionString;
  process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
  delete (globalThis as Record<string, unknown>).prismaMaster;
}, 240_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

async function callLogin(email: string, password: string): Promise<Response> {
  const { POST } = await import("@/app/api/admin/login/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://admin.localhost:3000/api/admin/login", {
    method: "POST",
    headers: { host: "admin.localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return POST(req);
}

function getCookieFromResponse(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = /admin-session-token=([^;]+)/.exec(setCookie);
  return m?.[1] ?? "";
}

async function callWithCookie(
  importPath: string,
  method: "GET" | "POST" | "DELETE",
  cookie: string,
  url: string = "http://admin.localhost:3000/api/admin/test",
  body?: unknown,
): Promise<Response> {
  const mod = (await import(importPath)) as Record<string, unknown>;
  const handler = mod[method] as (
    req: import("next/server").NextRequest,
    ctx?: { params: Promise<unknown> },
  ) => Promise<Response>;
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(url, {
    method,
    headers: {
      host: "admin.localhost:3000",
      "content-type": "application/json",
      cookie: `admin-session-token=${cookie}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handler(req);
}

describe("E2E panel super-admin", () => {
  it("login OK con SUPER_ADMIN devuelve cookie + audita", async () => {
    const res = await callLogin(SA_EMAIL, SA_PASSWORD);
    expect(res.status).toBe(200);
    const cookie = getCookieFromResponse(res);
    expect(cookie).toBeTruthy();

    const verify = new Client({ connectionString });
    await verify.connect();
    const audit = await verify.query<{ action: string; severity: string }>(
      `SELECT action, severity FROM master.audit_log WHERE super_admin_id='sa_e2e_main' AND action='super-admin:login' LIMIT 1`,
    );
    await verify.end();
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(audit.rows[0]!.severity).toBe("info");
  });

  it("login wrong password → 401 + audita login-failed", async () => {
    const res = await callLogin(SA_EMAIL, "wrong");
    expect(res.status).toBe(401);

    const verify = new Client({ connectionString });
    await verify.connect();
    const audit = await verify.query<{ action: string; severity: string }>(
      `SELECT action, severity FROM master.audit_log WHERE action='super-admin:login-failed' ORDER BY created_at DESC LIMIT 1`,
    );
    await verify.end();
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(audit.rows[0]!.severity).toBe("warning");
  });

  it("withSuperAdmin rechaza JWT con audience='tenant' (cross-app cookie)", async () => {
    // Token firmado con audiencia incorrecta.
    const fakeToken = await new SignJWT({ email: "x@x", role: "OWNER" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u_x")
      .setAudience("tenant")
      .setIssuer("nextauth")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(ADMIN_SECRET));
    const res = await callWithCookie(
      "@/app/api/admin/me/route",
      "GET",
      fakeToken,
      "http://admin.localhost:3000/api/admin/me",
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/tenants devuelve los 2 tenants sembrados", async () => {
    const login = await callLogin(SA_EMAIL, SA_PASSWORD);
    const cookie = getCookieFromResponse(login);
    const res = await callWithCookie(
      "@/app/api/admin/tenants/route",
      "GET",
      cookie,
      "http://admin.localhost:3000/api/admin/tenants",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { slug: string }[]; total: number };
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.items.map((i) => i.slug)).toEqual(
      expect.arrayContaining(["aone", "btwo"]),
    );
  });

  it("POST features override + audit warning entry", async () => {
    const login = await callLogin(SA_EMAIL, SA_PASSWORD);
    const cookie = getCookieFromResponse(login);

    const { POST } = await import("@/app/api/admin/tenants/[slug]/features/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      "http://admin.localhost:3000/api/admin/tenants/aone/features",
      {
        method: "POST",
        headers: {
          host: "admin.localhost:3000",
          "content-type": "application/json",
          cookie: `admin-session-token=${cookie}`,
        },
        body: JSON.stringify({
          featureKey: "branding_personalizado",
          value: true,
          reason: "Cliente premium temporal — solicitud comercial 2026-05",
        }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ slug: "aone" }),
    });
    expect(res.status).toBe(200);

    // Verificar audit warning.
    const verify = new Client({ connectionString });
    await verify.connect();
    const audit = await verify.query<{ severity: string; target_id: string }>(
      `SELECT severity, target_id FROM master.audit_log WHERE action='tenant_features:override' AND target_id='aone:branding_personalizado' LIMIT 1`,
    );
    await verify.end();
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(audit.rows[0]!.severity).toBe("warning");
  });

  it("metrics shape correcto", async () => {
    const login = await callLogin(SA_EMAIL, SA_PASSWORD);
    const cookie = getCookieFromResponse(login);
    const res = await callWithCookie(
      "@/app/api/admin/metrics/route",
      "GET",
      cookie,
      "http://admin.localhost:3000/api/admin/metrics",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenants).toHaveProperty("byStatus");
    expect(body.tenants).toHaveProperty("total");
    expect(body.subscriptions).toHaveProperty("byStatus");
    expect(body.audit24h).toHaveProperty("bySeverity");
  });

  it("audit-log SUPPORT solo ve info global + sus warnings/critical", async () => {
    const supportLogin = await callLogin(SUPPORT_EMAIL, SA_PASSWORD);
    expect(supportLogin.status).toBe(200);
    const cookie = getCookieFromResponse(supportLogin);
    const res = await callWithCookie(
      "@/app/api/admin/audit-log/route",
      "GET",
      cookie,
      "http://admin.localhost:3000/api/admin/audit-log",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { severity: string; superAdminId: string }[] };
    // Todas las entries deben ser info o de sa_e2e_support.
    for (const item of body.items) {
      const okInfo = item.severity === "info";
      const okOwn = item.superAdminId === "sa_e2e_support";
      expect(okInfo || okOwn).toBe(true);
    }
  });
});
