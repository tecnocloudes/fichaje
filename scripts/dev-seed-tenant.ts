#!/usr/bin/env node
/**
 * dev:seed-tenant — sembra un tenant `dev` listo para login en desarrollo.
 *
 * Solo se permite ejecutar con NODE_ENV=development. Crea/asegura:
 *   - tenant `dev` en master.tenants (status=active) vía
 *     `tenants:provision` flow simplificado.
 *   - schema `tenant_dev` con la estructura del producto aplicada.
 *   - Usuario OWNER `admin@dev.local` con password `dev_password_2026`
 *     para login local.
 *
 * El email/password son **hardcodeados** y **solo se aceptan si
 * NODE_ENV=development**. En producción el script aborta.
 *
 * Uso:
 *   NODE_ENV=development npm run dev:seed-tenant
 *   # luego abre http://dev.localhost:3000/login
 *
 * Para que `dev.localhost` resuelva al servidor Next dev, basta con
 * que tu sistema operativo trate `*.localhost` como 127.0.0.1 (lo
 * hacen macOS y la mayoría de Linux modernos por defecto).
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { isValidTenantSlug, quoteSchemaName } from "../src/lib/tenant/quote";
import { prismaMaster } from "../src/lib/prisma";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DEV_SLUG = "dev";
const DEV_EMAIL = "admin@dev.local";
const DEV_PASSWORD = "dev_password_2026";
const DEV_PLAN = "starter";

async function main() {
  if (process.env.NODE_ENV !== "development") {
    console.error("dev:seed-tenant solo se ejecuta con NODE_ENV=development.");
    process.exit(2);
  }

  if (!isValidTenantSlug(DEV_SLUG)) {
    throw new Error("DEV_SLUG inválido (no debería pasar).");
  }

  const url = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("MASTER_DATABASE_URL no definida.");

  // 1. Verificar plan starter.
  const plan = await prismaMaster.plan.findUnique({
    where: { key: DEV_PLAN },
    include: { planFeatures: true },
  });
  if (!plan) {
    console.error(
      `Plan "${DEV_PLAN}" no encontrado. Ejecuta primero la seed de master:\n` +
        `  npm run db:seed -- master`,
    );
    process.exit(2);
  }

  const schemaIdent = quoteSchemaName(DEV_SLUG);

  // 2. Crear schema + grants + aplicar migraciones del producto.
  console.log(`→ schema ${schemaIdent}`);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaIdent}`);
    // No fallamos si app_role no existe en local — desarrollador puede
    // estar usando el rol postgres directamente. Ignoramos errores de
    // GRANT si el rol no existe.
    try {
      await client.query(`GRANT USAGE ON SCHEMA ${schemaIdent} TO app_role`);
    } catch (e) {
      console.warn(
        `(aviso) GRANT a app_role falló: ${(e as Error).message.split("\n")[0]} — desarrollador local puede ignorar.`,
      );
    }

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
      const sql = readFileSync(
        path.join(migrationsDir, folder, "migration.sql"),
        "utf8",
      );
      console.log(`  → aplicando ${folder}`);
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL search_path TO ${schemaIdent}, public`);
        await client.query(sql);
        await client.query("COMMIT");
      } catch (e) {
        const msg = (e as Error).message;
        await client.query("ROLLBACK");
        // Si las tablas ya existen (segunda ejecución), continuar.
        if (msg.includes("already exists")) {
          console.log(`    (ya estaba aplicado)`);
          continue;
        }
        throw e;
      }
    }

    // 3. Sembrar User OWNER en el schema del tenant.
    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);
    await client.query(`SET search_path TO ${schemaIdent}, public`);
    await client.query(
      `INSERT INTO "User" (id, email, password, nombre, apellidos, rol, "createdAt", "updatedAt")
       VALUES ('u_dev_admin', $1, $2, 'Dani', 'Dev', 'OWNER', now(), now())
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, "updatedAt" = now()`,
      [DEV_EMAIL, passwordHash],
    );
  } finally {
    await client.end();
  }

  // 4. Insertar/actualizar tenant en master.tenants.
  // Si tenants:provision ya creó la fila, reusamos su id (cuid). Si no
  // existe, la creamos aquí.
  const tenant = await prismaMaster.tenant.upsert({
    where: { slug: DEV_SLUG },
    create: {
      slug: DEV_SLUG,
      name: "dev",
      email: "dev@dev.local",
      status: "active",
    },
    update: { status: "active" },
  });

  // 5. tenant_features con el plan (usa el id real de la fila).
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

  console.log("\n✅ tenant 'dev' listo.");
  console.log(`   URL:      http://dev.localhost:3000/login`);
  console.log(`   email:    ${DEV_EMAIL}`);
  console.log(`   password: ${DEV_PASSWORD}`);
  console.log(`   plan:     ${DEV_PLAN}`);
  console.log("\n⚠️  Estas credenciales SOLO son válidas en NODE_ENV=development.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
