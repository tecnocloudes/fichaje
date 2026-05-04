#!/usr/bin/env node
/**
 * tenants:migrate <slug> — aplica migraciones del producto al schema
 *                          tenant_<slug>.
 * tenants:migrate:all     — itera tenants ACTIVE/SUSPENDED + aplica.
 *
 * El schema "template" se acepta como slug especial: aplica las
 * migraciones a `tenant_template` (la plantilla creada por
 * scripts/sql/01-tenant-template.sql, commit 11).
 *
 * Tracking dentro de cada schema: tabla `_prisma_migrations_tenant`
 * con (migration_name, applied_at). Idempotente — si una migración ya
 * está marcada, se salta. No usamos `_prisma_migrations` (de Prisma
 * estándar) porque no llamamos al CLI de prisma — orquestamos el SQL
 * directamente vía pg.
 *
 * Fallo: aborta al primer error (ADR-005 §3.3). El estado parcial queda
 * mitigado por la convención backward-compatible (ADR-005 §2.5.a).
 *
 * Uso:
 *   npm run tenants:migrate -- <slug>
 *   npm run tenants:migrate -- template
 *   npm run tenants:migrate:all
 */

import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { isValidTenantSlug, quoteSchemaName } from "../src/lib/tenant/quote";
import { prismaMaster } from "../src/lib/prisma";

const USAGE = `
tenants:migrate <slug>      Aplica migraciones del producto a tenant_<slug>.
tenants:migrate template    Aplica al schema plantilla tenant_template.
tenants:migrate --all       Itera tenants ACTIVE/SUSPENDED y aplica a todos.
`.trim();

const MIGRATIONS_DIR = path.resolve(
  process.cwd(),
  "prisma",
  "migrations-tenant",
);

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }

  const isAll = args.includes("--all");
  if (isAll) {
    return runAll();
  }

  const target = args[0]!;
  if (target === "template") {
    return runOne("template", "tenant_template");
  }
  if (!isValidTenantSlug(target)) {
    console.error(`Slug "${target}" no cumple regex.`);
    process.exit(2);
  }
  // Verificar que el tenant existe en master.tenants. Para "template"
  // no aplica.
  const tenant = await prismaMaster.tenant.findUnique({
    where: { slug: target },
  });
  if (!tenant) {
    console.error(`tenant "${target}" no existe en master.tenants.`);
    process.exit(2);
  }
  return runOne(target, `tenant_${target}`);
}

async function runAll() {
  const tenants = await prismaMaster.tenant.findMany({
    where: { status: { in: ["active", "suspended"] } },
    orderBy: { createdAt: "asc" },
    select: { slug: true },
  });
  console.log(`→ ${tenants.length} tenants a migrar`);
  // Empezamos por template para que las plantillas estén al día.
  await runOne("template", "tenant_template");
  for (const t of tenants) {
    await runOne(t.slug, `tenant_${t.slug}`);
  }
  console.log(`\n✅ migraciones aplicadas a ${tenants.length + 1} schemas.`);
}

async function runOne(label: string, schemaName: string): Promise<void> {
  const url = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("MASTER_DATABASE_URL no definida.");

  // Validamos schemaName aquí también — defensa en profundidad. El
  // label "template" pasa porque schemaName fue construido literalmente.
  const schemaIdent =
    schemaName === "tenant_template"
      ? '"tenant_template"'
      : quoteSchemaName(label);

  const folders = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
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

    let count = 0;
    for (const folder of folders) {
      if (applied.has(folder)) continue;
      const sqlPath = path.join(MIGRATIONS_DIR, folder, "migration.sql");
      const sql = readFileSync(sqlPath, "utf8");
      console.log(`→ [${label}] aplicar ${folder}`);
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL search_path TO ${schemaIdent}, public`);
        await client.query(sql);
        await client.query(
          `INSERT INTO _prisma_migrations_tenant (migration_name) VALUES ($1)`,
          [folder],
        );
        await client.query("COMMIT");
        count++;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
    if (count === 0) {
      console.log(`→ [${label}] al día (0 migraciones aplicadas)`);
    } else {
      console.log(`→ [${label}] ${count} migración(es) aplicada(s)`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
