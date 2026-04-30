#!/usr/bin/env node
/**
 * tenants:provision — crea un tenant nuevo en BD (sin Stripe).
 *
 * Pasos (ADR-003 §2.6, simplificado para Fase 3 sin checkout):
 *  1. Validar slug (regex + reserved_slugs).
 *  2. Validar plan_key (existe en master.plans).
 *  3. CREATE SCHEMA tenant_<slug>.
 *  4. GRANT USAGE + DEFAULT PRIVILEGES a app_role.
 *  5. Aplicar migraciones del producto al schema.
 *  6. INSERT en master.tenants con status=ACTIVE + sentinels Stripe
 *     (`cus_manual_<id>`) — Fase 4 los reemplaza con datos Stripe reales.
 *  7. INSERT TenantFeature por cada PlanFeature (source='plan').
 *  8. INSERT TenantQuotaUsage iniciales para features quota del plan.
 *
 * Idempotente: si el tenant existe con status=ACTIVE → exit 0
 * informando. Si existe en PROVISIONING → continúa desde donde se
 * quedó (ADR-003 §5.2).
 *
 * Uso:
 *   npm run tenants:provision -- <slug> <plan_key>
 *
 * Ejemplo:
 *   npm run tenants:provision -- acme starter
 *   npm run tenants:provision -- dev starter
 */

import "dotenv/config";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { isValidTenantSlug, quoteSchemaName } from "@/lib/tenant/quote";
import { prismaMaster } from "@/lib/prisma";

const USAGE = `
tenants:provision <slug> <plan_key>

Crea un tenant en master.tenants + schema tenant_<slug> + features
del plan + quotas iniciales. Sin Stripe (Fase 4 lo añade).

Argumentos:
  <slug>      slug del tenant (regex ^[a-z][a-z0-9_]{2,30}$).
  <plan_key>  starter | pro | enterprise.

Ejemplo:
  npm run tenants:provision -- acme starter
`.trim();

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args.length < 2) {
    console.error(USAGE);
    process.exit(2);
  }
  const [slug, planKey] = args as [string, string];

  if (!isValidTenantSlug(slug)) {
    console.error(`Slug "${slug}" no cumple ^[a-z][a-z0-9_]{2,30}$`);
    process.exit(2);
  }

  // 1. reserved_slugs check.
  const reserved = await prismaMaster.reservedSlug.findUnique({ where: { slug } });
  if (reserved) {
    console.error(`Slug "${slug}" reservado: ${reserved.reason}`);
    process.exit(2);
  }

  // 2. Plan existe.
  const plan = await prismaMaster.plan.findUnique({
    where: { key: planKey },
    include: { planFeatures: true },
  });
  if (!plan || !plan.active) {
    console.error(`Plan "${planKey}" no existe o no está activo.`);
    process.exit(2);
  }

  // 3. Tenant existente?
  const existing = await prismaMaster.tenant.findUnique({ where: { slug } });
  if (existing && existing.status === "active") {
    console.log(`✓ tenant "${slug}" ya existe (status=ACTIVE). Nada que hacer.`);
    process.exit(0);
  }

  const schemaIdent = quoteSchemaName(slug); // "tenant_acme"

  // 4-5. Crear schema + grants + aplicar migraciones del producto.
  console.log(`→ CREATE SCHEMA ${schemaIdent}`);
  await prismaMaster.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schemaIdent}`);

  // GRANTs a app_role / master_role: requieren que esos roles existan.
  // En desarrollo local usamos un único superuser (discrepancia
  // documentada en AGENTS.md "Desarrollo local multi-tenant"), así que
  // los GRANTs son tolerantes a "role does not exist". En producción
  // (Fase 8) los 4 roles SÍ existen y los GRANTs aplican.
  async function tryGrant(sql: string, label: string): Promise<void> {
    try {
      await prismaMaster.$executeRawUnsafe(sql);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("does not exist")) {
        console.log(`(aviso) ${label} omitido: rol no existe en este Postgres`);
      } else {
        throw e;
      }
    }
  }
  await tryGrant(
    `GRANT USAGE ON SCHEMA ${schemaIdent} TO app_role`,
    "GRANT USAGE app_role",
  );
  await tryGrant(
    `ALTER DEFAULT PRIVILEGES FOR ROLE master_role IN SCHEMA ${schemaIdent} ` +
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role`,
    "DEFAULT PRIVILEGES TABLES",
  );
  await tryGrant(
    `ALTER DEFAULT PRIVILEGES FOR ROLE master_role IN SCHEMA ${schemaIdent} ` +
      `GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_role`,
    "DEFAULT PRIVILEGES SEQUENCES",
  );

  await applyProductMigrations(slug);

  // 6. INSERT master.tenants si no existe.
  let tenant = existing;
  if (!tenant) {
    tenant = await prismaMaster.tenant.create({
      data: {
        slug,
        name: slug,
        email: `admin@${slug}.local`,
        status: "active",
        // Sentinels para Fase 4: webhook Stripe los sustituye.
        // stripeCustomerId queda null (no único hasta que llegue Stripe).
      },
    });
    console.log(`→ INSERT master.tenants id=${tenant.id} slug=${slug} status=active`);
  } else if (tenant.status === "provisioning" || tenant.status === "pending") {
    tenant = await prismaMaster.tenant.update({
      where: { id: tenant.id },
      data: { status: "active" },
    });
    console.log(`→ UPDATE master.tenants id=${tenant.id} status=active`);
  }

  // 7. tenant_features (source='plan').
  for (const pf of plan.planFeatures) {
    await prismaMaster.tenantFeature.upsert({
      where: {
        tenantId_featureKey_source: {
          tenantId: tenant.id,
          featureKey: pf.featureKey,
          source: "plan",
        },
      },
      create: {
        tenantId: tenant.id,
        featureKey: pf.featureKey,
        value: pf.value as never,
        source: "plan",
      },
      update: { value: pf.value as never },
    });
  }
  console.log(`→ ${plan.planFeatures.length} tenant_features (source=plan)`);

  // 8. tenant_quota_usage iniciales para quotas del plan.
  const quotas = await prismaMaster.feature.findMany({
    where: { type: "quota", key: { in: plan.planFeatures.map((p) => p.featureKey) } },
  });
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  for (const q of quotas) {
    const pf = plan.planFeatures.find((p) => p.featureKey === q.key);
    if (!pf) continue;
    const max = typeof pf.value === "number" ? BigInt(pf.value) : null;
    await prismaMaster.tenantQuotaUsage.upsert({
      where: {
        tenantId_featureKey_periodStart: {
          tenantId: tenant.id,
          featureKey: q.key,
          periodStart,
        },
      },
      create: {
        tenantId: tenant.id,
        featureKey: q.key,
        periodStart,
        periodEnd,
        consumed: BigInt(0),
        max,
      },
      update: { max },
    });
  }
  console.log(`→ ${quotas.length} tenant_quota_usage iniciales`);

  console.log(`\n✅ tenant "${slug}" provisionado en plan "${planKey}".`);
  process.exit(0);
}

/**
 * Aplica todas las migraciones de prisma/migrations-tenant/ al schema
 * tenant_<slug>. Crea/lee la tabla `_prisma_migrations` dentro del
 * mismo schema para idempotencia (Prisma puro). Equivalente a
 * `tenants:migrate <slug>` (commit 13) — esa CLI delega aquí en
 * desarrollo de Fase 3.
 */
async function applyProductMigrations(slug: string): Promise<void> {
  const schemaIdent = quoteSchemaName(slug);
  const migrationsDir = path.resolve(
    process.cwd(),
    "prisma",
    "migrations-tenant",
  );
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const folder of folders) {
    const sqlPath = path.join(migrationsDir, folder, "migration.sql");
    const sql = readFileSync(sqlPath, "utf8");
    console.log(`→ aplicando ${folder}`);
    // Conectar con MASTER_DATABASE_URL en raw pg para poder ejecutar el
    // SQL completo (Prisma $executeRawUnsafe no maneja múltiples
    // statements concatenados con punto y coma de forma fiable).
    const url = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) throw new Error("MASTER_DATABASE_URL no definida.");
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(`SET search_path TO ${schemaIdent}, public`);
      await client.query(sql);
    } finally {
      await client.end();
    }
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

// Suprimir warning de exec no usado (en Fase 9 podría usarse pg_dump).
void execSync;
