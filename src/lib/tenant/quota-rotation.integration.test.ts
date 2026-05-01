/**
 * Test integration de auto-rotación de quotas en consumeQuota.
 *
 * Bug detectado en post-fix-1 (verificación local): consumeQuota
 * antes devolvía period_unavailable indefinidamente cuando period_end
 * pasaba — no había rotación. El refactor a INSERT...ON CONFLICT
 * atómico crea fila nueva al detectar nuevo período.
 *
 * Verifica:
 *  1. Tenant con fila vencida (period_end ayer, consumed=3, max=3)
 *     → consumeQuota crea fila NUEVA con consumed=1 → 2 filas en BD.
 *  2. consumed sube 1, 2, 3 con cada llamada.
 *  3. 4ª llamada → limit_reached (max=3 alcanzado en nuevo período).
 *  4. La fila vieja sigue intacta (auditable).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Client } from "pg";
import { runWithTenant } from "./context";
import { consumeQuota, _setFeatureCatalogForTest } from "./features";

let container: StartedPostgreSqlContainer;
let connectionString: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_rot")
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
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quota_writer_role') THEN
        CREATE ROLE quota_writer_role WITH LOGIN PASSWORD 'rot_quota';
      END IF;
    END $$;
  `);
  await adminClient.query(`GRANT USAGE ON SCHEMA master TO quota_writer_role`);
  await adminClient.query(
    `GRANT SELECT, INSERT, UPDATE ON master.tenant_quota_usage TO quota_writer_role`,
  );

  await adminClient.query(`
    INSERT INTO master.tenants (id, slug, name, email, status, created_at, updated_at)
    VALUES ('tnt_rot', 'rot', 'Rot', 'admin@rot.local', 'active', now(), now())
    ON CONFLICT DO NOTHING
  `);
  await adminClient.query(`
    INSERT INTO master.features (id, key, name, type, quota_period, active, created_at, updated_at)
    VALUES ('f_exports_rot', 'exports_mes', 'Exports/mes', 'quota', 'mes', true, now(), now())
    ON CONFLICT DO NOTHING
  `);

  // Fila VENCIDA: period_end = un mes atrás. consumed=3 saturada.
  // Coherente con tenant que ya consumió toda la quota del mes anterior.
  await adminClient.query(`
    INSERT INTO master.tenant_quota_usage
      (id, tenant_id, feature_key, period_start, period_end, consumed, max, created_at, updated_at)
    VALUES
      ('tqu_rot_old', 'tnt_rot', 'exports_mes',
       (date_trunc('month', now()) - interval '1 month'),
       date_trunc('month', now()),
       3, 3, now(), now())
    ON CONFLICT DO NOTHING
  `);
  await adminClient.end();

  const u = new URL(connectionString);
  u.username = "quota_writer_role";
  u.password = "rot_quota";
  process.env.QUOTA_WRITER_DATABASE_URL = u.toString();
  process.env.MASTER_DATABASE_URL = connectionString;
  delete (globalThis as Record<string, unknown>).prismaQuotaWriter;
  delete (globalThis as Record<string, unknown>).prismaMaster;

  _setFeatureCatalogForTest(["exports_mes"]);
}, 180_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

const ctx = {
  tenantId: "tnt_rot",
  slug: "rot",
  status: "active" as const,
  features: new Map([
    [
      "exports_mes",
      {
        key: "exports_mes",
        value: 3,
        source: "plan" as const,
        expiresAt: null,
      },
    ],
  ]),
};

describe("consumeQuota — auto-rotación con UPSERT", () => {
  it("rota a nuevo período creando fila nueva (no toca la vencida)", async () => {
    const r1 = await runWithTenant(ctx, () =>
      consumeQuota("exports_mes", 1),
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("expected ok");
    expect(r1.remaining).toBe(2);

    // Verificar 2 filas en BD: la vieja intacta + la nueva con consumed=1.
    const verify = new Client({ connectionString });
    await verify.connect();
    const all = await verify.query<{
      consumed: string;
      max: string | null;
      period_start: Date;
      period_end: Date;
    }>(
      `SELECT consumed, max, period_start, period_end
         FROM master.tenant_quota_usage
        WHERE tenant_id = $1 AND feature_key = $2
        ORDER BY period_start ASC`,
      ["tnt_rot", "exports_mes"],
    );
    await verify.end();
    expect(all.rows).toHaveLength(2);
    // Fila vieja intacta.
    expect(Number(all.rows[0]!.consumed)).toBe(3);
    // Fila nueva con consumed=1 y period_start posterior a la vieja
    // (no necesariamente igual a period_end de la vieja por offset de
    // timezone entre date_trunc en Postgres UTC vs computeCurrentPeriod
    // en hora local del proceso — ver comentarios en period.ts).
    expect(Number(all.rows[1]!.consumed)).toBe(1);
    expect(all.rows[1]!.period_start.getTime()).toBeGreaterThan(
      all.rows[0]!.period_start.getTime(),
    );
  });

  it("invocaciones sucesivas suman consumed en la fila nueva", async () => {
    const r2 = await runWithTenant(ctx, () =>
      consumeQuota("exports_mes", 1),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("expected ok");
    expect(r2.remaining).toBe(1);

    const r3 = await runWithTenant(ctx, () =>
      consumeQuota("exports_mes", 1),
    );
    expect(r3.ok).toBe(true);
    if (!r3.ok) throw new Error("expected ok");
    expect(r3.remaining).toBe(0);
  });

  it("4ª invocación con max=3 ya saturado → limit_reached", async () => {
    const r4 = await runWithTenant(ctx, () =>
      consumeQuota("exports_mes", 1),
    );
    expect(r4.ok).toBe(false);
    if (r4.ok) throw new Error("expected not ok");
    expect(r4.reason).toBe("limit_reached");
    if (r4.reason !== "limit_reached") throw new Error("wrong reason");
    expect(r4.used).toBe(3);
    expect(r4.max).toBe(3);
  });
});
