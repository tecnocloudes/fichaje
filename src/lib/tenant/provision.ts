/**
 * provisionTenantSchema — crea schema tenant_<slug> + GRANTs +
 * aplica migraciones del producto. Reusable desde:
 *
 *  - scripts/tenants-provision.ts (CLI manual, cutover, dev).
 *  - src/lib/stripe/handlers/checkout-session-completed.ts (webhook).
 *
 * Idempotente:
 *  - CREATE SCHEMA IF NOT EXISTS.
 *  - GRANTs tolerantes a "role does not exist" en local (un superuser).
 *  - applyProductMigrations salta migraciones ya aplicadas vía
 *    _prisma_migrations_tenant.
 *
 * Reutiliza la lógica de Fase 3 (commit 12+13). NO toca master.tenants
 * ni tenant_features — eso es responsabilidad del caller (CLI o
 * webhook handler) según su flujo concreto.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { prismaMaster } from "@/lib/prisma";
import { quoteSchemaName } from "@/lib/tenant/quote";

/**
 * Crea el schema `tenant_<slug>`, aplica GRANTs a `app_role` (tolerante)
 * y ejecuta las migraciones del producto. Idempotente.
 */
export async function provisionTenantSchema(slug: string): Promise<void> {
  const schemaIdent = quoteSchemaName(slug);

  await prismaMaster.$executeRawUnsafe(
    `CREATE SCHEMA IF NOT EXISTS ${schemaIdent}`,
  );

  await tryGrant(`GRANT USAGE ON SCHEMA ${schemaIdent} TO app_role`);
  await tryGrant(
    `ALTER DEFAULT PRIVILEGES FOR ROLE master_role IN SCHEMA ${schemaIdent} ` +
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role`,
  );
  await tryGrant(
    `ALTER DEFAULT PRIVILEGES FOR ROLE master_role IN SCHEMA ${schemaIdent} ` +
      `GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_role`,
  );

  await applyProductMigrations(slug);
}

async function tryGrant(sql: string): Promise<void> {
  try {
    await prismaMaster.$executeRawUnsafe(sql);
  } catch (e) {
    const msg = (e as Error).message;
    // En dev local con un único superuser, app_role no existe — está bien.
    if (msg.includes("does not exist")) return;
    throw e;
  }
}

/**
 * Aplica migraciones de `prisma/migrations-tenant/` al schema del
 * tenant. Tracking en `_prisma_migrations_tenant` dentro del propio
 * schema (Fase 3).
 *
 * Usa `pg.Client` directo (no Prisma) porque las migraciones contienen
 * múltiples statements separados por `;` que `$executeRawUnsafe` no
 * maneja fiablemente.
 */
async function applyProductMigrations(slug: string): Promise<void> {
  const schemaIdent = quoteSchemaName(slug);
  const url = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("MASTER_DATABASE_URL no definida.");

  const migrationsDir = path.resolve(
    process.cwd(),
    "prisma",
    "migrations-tenant",
  );
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`SET search_path TO ${schemaIdent}, public`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS _prisma_migrations_tenant (
        migration_name varchar(255) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const appliedRows = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM _prisma_migrations_tenant`,
    );
    const applied = new Set(appliedRows.rows.map((r) => r.migration_name));

    for (const folder of folders) {
      if (applied.has(folder)) continue;
      const sql = readFileSync(
        path.join(migrationsDir, folder, "migration.sql"),
        "utf8",
      );
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL search_path TO ${schemaIdent}, public`);
        await client.query(sql);
        await client.query(
          `INSERT INTO _prisma_migrations_tenant (migration_name) VALUES ($1)`,
          [folder],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.end();
  }
}
