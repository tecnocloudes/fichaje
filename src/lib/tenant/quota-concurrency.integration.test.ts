/**
 * Test de concurrencia para consumeQuota — Plan Fase 5 §7.2.
 *
 * Lanza 100 promesas concurrentes contra una quota con max=50.
 * Esperado: 50 ok + 50 limit_reached. consumed final = 50 exacto.
 *
 * Verifica empíricamente la garantía atómica del UPDATE con
 * `WHERE consumed + n <= max RETURNING` (ADR-004 §2.5). Si el SQL
 * no fuera atómico (race entre SELECT y UPDATE), bajo concurrencia
 * se observaría consumed > 50 o ok > 50.
 *
 * Tiempo estimado: ~30-50s (Testcontainer + migraciones).
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
import { runWithTenant } from "./context";
import {
  consumeQuota,
  _setFeatureCatalogForTest,
} from "./features";

let container: StartedPostgreSqlContainer;
let connectionString: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_quota")
    .withUsername("postgres")
    .withPassword("test")
    .start();
  connectionString = container.getConnectionUri();

  // Master schema + tenant_quota_usage table.
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: "pipe",
  });

  // Roles requeridos. Replicamos 00-roles.sql con passwords fijas.
  const adminClient = new Client({ connectionString });
  await adminClient.connect();
  await adminClient.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'master_role') THEN
        CREATE ROLE master_role WITH LOGIN PASSWORD 'qtest_master';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quota_writer_role') THEN
        CREATE ROLE quota_writer_role WITH LOGIN PASSWORD 'qtest_quota';
      END IF;
    END $$;
  `);
  await adminClient.query(`GRANT USAGE ON SCHEMA master TO quota_writer_role`);
  await adminClient.query(
    `GRANT SELECT, INSERT, UPDATE ON master.tenant_quota_usage TO quota_writer_role`,
  );

  // Sembrar tenant + feature + tenant_quota_usage con max=50, consumed=0.
  await adminClient.query(`
    INSERT INTO master.tenants (id, slug, name, email, status, created_at, updated_at)
    VALUES ('tnt_qtest', 'qtest', 'QTest', 'admin@qtest.local', 'active', now(), now())
    ON CONFLICT DO NOTHING
  `);
  await adminClient.query(`
    INSERT INTO master.features (id, key, name, type, quota_period, active, created_at, updated_at)
    VALUES ('f_exports_mes', 'exports_mes', 'Exports/mes', 'quota', 'mes', true, now(), now())
    ON CONFLICT DO NOTHING
  `);
  // NO sembramos tenant_quota_usage: el nuevo consumeQuota con
  // UPSERT crea la fila en la primera invocación (auto-rotación).
  // Verificamos exactamente esa propiedad implícitamente: 50 ok +
  // 50 limit_reached + consumed=50 → la fila inicial la creó la
  // primera Promise concurrente.
  await adminClient.end();

  // Configurar prismaQuotaWriter para usar quota_writer_role.
  const u = new URL(connectionString);
  u.username = "quota_writer_role";
  u.password = "qtest_quota";
  process.env.QUOTA_WRITER_DATABASE_URL = u.toString();
  process.env.MASTER_DATABASE_URL = connectionString;
  delete (globalThis as Record<string, unknown>).prismaQuotaWriter;
  delete (globalThis as Record<string, unknown>).prismaMaster;

  _setFeatureCatalogForTest(["exports_mes"]);
}, 180_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

describe("consumeQuota — concurrencia 100 promesas con max=50", () => {
  it("exactamente 50 ok + 50 limit_reached, consumed final = 50", async () => {
    // El nuevo consumeQuota lee max desde ctx.features.get(key), que
    // refleja master.tenant_features en memoria. Sembramos manual.
    const ctx = {
      tenantId: "tnt_qtest",
      slug: "qtest",
      status: "active" as const,
      features: new Map([
        [
          "exports_mes",
          {
            key: "exports_mes",
            value: 50,
            source: "plan" as const,
            expiresAt: null,
          },
        ],
      ]),
    };

    const results = await runWithTenant(ctx, async () => {
      const promises = Array.from({ length: 100 }, () =>
        consumeQuota("exports_mes", 1),
      );
      return Promise.all(promises);
    });

    const okCount = results.filter((r) => r.ok).length;
    const limitReachedCount = results.filter(
      (r) => !r.ok && r.reason === "limit_reached",
    ).length;
    const periodUnavailableCount = results.filter(
      (r) => !r.ok && r.reason === "period_unavailable",
    ).length;

    expect(okCount).toBe(50);
    expect(limitReachedCount).toBe(50);
    expect(periodUnavailableCount).toBe(0);

    // Verificar consumed final en BD con cliente directo.
    const verify = new Client({ connectionString });
    await verify.connect();
    const r = await verify.query<{ consumed: string }>(
      `SELECT consumed FROM master.tenant_quota_usage WHERE tenant_id = $1 AND feature_key = $2`,
      ["tnt_qtest", "exports_mes"],
    );
    await verify.end();
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0]!.consumed)).toBe(50);
  });
});
