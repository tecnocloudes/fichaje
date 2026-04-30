/**
 * Verificación empírica de la Enmienda 2 del plan de Fase 4 (parada 1).
 *
 * Tras provisionTenantSchema(slug), el cliente Prisma multiplexado
 * (`globalThis._tenantClients`) abre correctamente el schema recién
 * creado en su primera conexión.
 *
 * Test:
 *  1. Limpiar globalThis._tenantClients antes de la coreografía.
 *  2. Crear schema fresco con provisionTenantSchema('test_<random>').
 *  3. invalidateTenantClient(slug).
 *  4. runWithTenant + prismaApp.user.create (no debe fallar con
 *     "schema does not exist" ni "permission denied").
 *  5. Verificar la fila desde fuera con pg directo.
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

let container: StartedPostgreSqlContainer;
let connectionString: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_prov")
    .withUsername("postgres")
    .withPassword("test")
    .start();
  connectionString = container.getConnectionUri();

  // Migraciones master.
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: "pipe",
  });

  // Master URL para que prismaMaster (lazy) lo use cuando se importe.
  process.env.MASTER_DATABASE_URL = connectionString;
  process.env.APP_DATABASE_URL = connectionString;

  // Reset globalThis caches que puedan haber quedado de otros tests.
  delete (globalThis as Record<string, unknown>).prismaMaster;
  delete (globalThis as Record<string, unknown>).prismaApp;
  delete (globalThis as Record<string, unknown>)._tenantClients;
}, 180_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

describe("provisionTenantSchema + cliente Prisma multiplexado (Enmienda 2)", () => {
  it("crea schema, aplica migraciones y prismaApp.user.create funciona", async () => {
    const slug = `test${Date.now().toString(36).slice(-6)}`;
    const { provisionTenantSchema } = await import("./provision");
    const { prismaApp, invalidateTenantClient } = await import("@/lib/prisma");
    const { runWithTenant } = await import("./context");

    // 1. Provisionar schema.
    await provisionTenantSchema(slug);

    // 2. Verificar con pg directo que el schema y las tablas existen.
    const adminClient = new Client({ connectionString });
    await adminClient.connect();
    try {
      const r = await adminClient.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
        [`tenant_${slug}`],
      );
      const tableNames = r.rows.map((r) => r.table_name as string);
      expect(tableNames).toContain("User");
      expect(tableNames).toContain("Tienda");
      expect(tableNames).toContain("Fichaje");
    } finally {
      await adminClient.end();
    }

    // 3. Invalidar cliente cacheado (Enmienda 2 del plan).
    invalidateTenantClient(slug);

    // 4. runWithTenant + prismaApp.user.create. El cliente Prisma
    //    multiplexado debe abrir el schema recién creado sin error.
    const result = await runWithTenant(
      {
        tenantId: `tnt_${slug}`,
        slug,
        status: "active",
        features: new Map(),
      },
      async () => {
        return await prismaApp.user.create({
          data: {
            email: `owner@${slug}.local`,
            nombre: "Test",
            apellidos: "Owner",
            rol: "OWNER",
          },
        });
      },
    );
    expect(result.email).toBe(`owner@${slug}.local`);
    expect(result.rol).toBe("OWNER");

    // 5. Verificar la fila desde fuera con pg directo.
    const verifyClient = new Client({ connectionString });
    await verifyClient.connect();
    try {
      await verifyClient.query(
        `SET search_path TO "tenant_${slug}", public`,
      );
      const rows = await verifyClient.query(
        `SELECT email, rol FROM "User" WHERE email = $1`,
        [`owner@${slug}.local`],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].email).toBe(`owner@${slug}.local`);
      expect(rows.rows[0].rol).toBe("OWNER");
    } finally {
      await verifyClient.end();
    }
  });

  it("provisionTenantSchema es idempotente (segunda invocación no falla)", async () => {
    const slug = `test${Date.now().toString(36).slice(-6)}b`;
    const { provisionTenantSchema } = await import("./provision");
    await provisionTenantSchema(slug);
    // Segunda invocación: no lanza, no duplica.
    await expect(provisionTenantSchema(slug)).resolves.toBeUndefined();
  });
});
