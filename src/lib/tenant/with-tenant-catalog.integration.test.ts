/**
 * Test integration crítico del bug detectado en bloque A:
 * un handler envuelto con withTenant + withFeature debe funcionar
 * en proceso "limpio" (sin _setFeatureCatalogForTest llamado nunca),
 * porque withTenant llama a ensureFeatureCatalogLoaded internamente.
 *
 * Antes del fix, este test fallaba con "FEATURE_CATALOG no cargado".
 * Es el test que habría detectado el bug en Fase 5.
 *
 * Setup: Postgres efímero + master schema + 1 tenant + features
 * sembradas (catálogo). NO setea _setFeatureCatalogForTest.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Client } from "pg";
import { NextRequest, NextResponse } from "next/server";

let container: StartedPostgreSqlContainer;
let connectionString: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_catalog")
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
  // Sembrar tenant + features mínimas (catálogo).
  await adminClient.query(`
    INSERT INTO master.tenants (id, slug, name, email, status, created_at, updated_at)
    VALUES ('tnt_cat', 'cat', 'Cat', 'admin@cat.local', 'active', now(), now())
    ON CONFLICT DO NOTHING
  `);
  await adminClient.query(`
    INSERT INTO master.features (id, key, name, type, quota_period, active, created_at, updated_at)
    VALUES
      ('f_geo_cat', 'geofencing', 'Geofencing', 'boolean', NULL, true, now(), now()),
      ('f_csv_cat', 'export_csv', 'Export CSV', 'boolean', NULL, true, now(), now())
    ON CONFLICT DO NOTHING
  `);
  await adminClient.query(`
    INSERT INTO master.tenant_features (id, tenant_id, feature_key, value, source, created_at, updated_at)
    VALUES
      ('tf_geo_cat', 'tnt_cat', 'geofencing', 'true'::jsonb, 'plan', now(), now()),
      ('tf_csv_cat', 'tnt_cat', 'export_csv', 'false'::jsonb, 'plan', now(), now())
    ON CONFLICT DO NOTHING
  `);
  await adminClient.end();

  process.env.MASTER_DATABASE_URL = connectionString;
  process.env.APP_DATABASE_URL = connectionString;
  process.env.TENANT_RUNTIME_DATABASE_URL = connectionString;
  process.env.QUOTA_WRITER_DATABASE_URL = connectionString;
  delete (globalThis as Record<string, unknown>).prismaMaster;
  delete (globalThis as Record<string, unknown>).prismaRuntime;
  delete (globalThis as Record<string, unknown>).prismaQuotaWriter;
}, 180_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

describe("withTenant + ensureFeatureCatalogLoaded — proceso limpio", () => {
  it("hasFeature() dentro de un handler envuelto NO lanza (fix bug bloque A)", async () => {
    // CRÍTICO: NO llamamos _setFeatureCatalogForTest en este test.
    // En su lugar confiamos en que withTenant cargue el catálogo via
    // ensureFeatureCatalogLoaded antes de ejecutar el handler.
    const { withTenant } = await import("./with-tenant");
    const { hasFeature } = await import("./features");

    const handler = withTenant(async () => {
      // Esta línea lanza "FEATURE_CATALOG no cargado" sin el fix.
      const can = hasFeature("export_csv");
      return NextResponse.json({ export_csv: can });
    });

    const req = new NextRequest("http://cat.localhost:3000/api/test", {
      headers: { host: "cat.localhost:3000" },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ export_csv: false });
  });

  it("hasFeature() de feature presente devuelve true", async () => {
    const { withTenant } = await import("./with-tenant");
    const { hasFeature } = await import("./features");
    const handler = withTenant(async () => {
      return NextResponse.json({ geofencing: hasFeature("geofencing") });
    });
    const req = new NextRequest("http://cat.localhost:3000/api/test", {
      headers: { host: "cat.localhost:3000" },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ geofencing: true });
  });
});
