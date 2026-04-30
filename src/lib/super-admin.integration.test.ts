/**
 * Test de integración de upsertSuperAdmin contra Postgres real (Testcontainers).
 *
 * Verifica:
 * 1. Crear con email nuevo + password → fila insertada con hash bcrypt.
 * 2. Re-ejecutar con mismo email sin password → idempotencia (solo
 *    actualiza name/role; mismo hash).
 * 3. Re-ejecutar con --reset-password → hash cambia.
 * 4. Email se normaliza (lowercase + trim) → mismo registro.
 * 5. Password < 12 chars → throw.
 * 6. Crear sin password → throw.
 *
 * Tiempo: ~30-45s (levantar Postgres + migrar + tests).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { upsertSuperAdmin } from "./super-admin";

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_test")
    .withUsername("postgres")
    .withPassword("test")
    .start();

  const connectionString = container.getConnectionUri();
  // Aplicar migraciones con prisma migrate deploy contra el container.
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: "pipe",
  });

  // Cliente Prisma apuntando al container.
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
}, 30_000);

describe("upsertSuperAdmin (integration)", () => {
  it("crea cuenta nueva con password y hash bcrypt", async () => {
    const result = await upsertSuperAdmin(prisma, {
      email: "alice@tecnocloud.es",
      name: "Alice",
      password: "passwordSegura123",
    });

    expect(result.created).toBe(true);
    expect(result.passwordUpdated).toBe(true);
    expect(result.id).toMatch(/^c[a-z0-9]{20,}$/); // cuid

    const row = await prisma.superAdmin.findUnique({
      where: { email: "alice@tecnocloud.es" },
    });
    expect(row).not.toBeNull();
    expect(row!.name).toBe("Alice");
    expect(row!.role).toBe("SUPER_ADMIN");
    expect(row!.active).toBe(true);
    // Verificación bcrypt: el hash debe validar contra el password original.
    expect(await bcrypt.compare("passwordSegura123", row!.password)).toBe(true);
    // Y NO debe ser el password en plano.
    expect(row!.password).not.toBe("passwordSegura123");
    expect(row!.password.startsWith("$2")).toBe(true);
  });

  it("idempotencia sin password: actualiza name+role pero NO el hash", async () => {
    const before = await prisma.superAdmin.findUnique({
      where: { email: "alice@tecnocloud.es" },
    });
    expect(before).not.toBeNull();

    const result = await upsertSuperAdmin(prisma, {
      email: "alice@tecnocloud.es",
      name: "Alice (renombrada)",
      role: "SUPPORT",
    });

    expect(result.created).toBe(false);
    expect(result.passwordUpdated).toBe(false);

    const after = await prisma.superAdmin.findUnique({
      where: { email: "alice@tecnocloud.es" },
    });
    expect(after!.name).toBe("Alice (renombrada)");
    expect(after!.role).toBe("SUPPORT");
    // Mismo hash que antes — el password no se tocó.
    expect(after!.password).toBe(before!.password);
  });

  it("--reset-password: el hash cambia con un password nuevo", async () => {
    const before = await prisma.superAdmin.findUnique({
      where: { email: "alice@tecnocloud.es" },
    });

    const result = await upsertSuperAdmin(prisma, {
      email: "alice@tecnocloud.es",
      name: "Alice (renombrada)",
      role: "SUPPORT",
      password: "passwordNuevoOtro2026",
    });

    expect(result.created).toBe(false);
    expect(result.passwordUpdated).toBe(true);

    const after = await prisma.superAdmin.findUnique({
      where: { email: "alice@tecnocloud.es" },
    });
    // El hash es distinto al anterior.
    expect(after!.password).not.toBe(before!.password);
    // Y el nuevo hash valida contra el nuevo password.
    expect(await bcrypt.compare("passwordNuevoOtro2026", after!.password)).toBe(true);
    // El hash anterior ya no valida.
    expect(await bcrypt.compare("passwordSegura123", after!.password)).toBe(false);
  });

  it("normaliza email a lowercase + trim (mismo registro)", async () => {
    const result = await upsertSuperAdmin(prisma, {
      email: "  ALICE@TECNOCLOUD.ES  ",
      name: "Alice (otra vez)",
    });

    // Es la misma cuenta que las anteriores: created=false.
    expect(result.created).toBe(false);

    const count = await prisma.superAdmin.count({
      where: { email: "alice@tecnocloud.es" },
    });
    expect(count).toBe(1);
  });

  it("rechaza password < 12 caracteres", async () => {
    await expect(
      upsertSuperAdmin(prisma, {
        email: "bob@tecnocloud.es",
        name: "Bob",
        password: "corto",
      }),
    ).rejects.toThrow(/12 caracteres/);
  });

  it("rechaza crear cuenta nueva sin password", async () => {
    await expect(
      upsertSuperAdmin(prisma, {
        email: "carol@tecnocloud.es",
        name: "Carol",
      }),
    ).rejects.toThrow(/password es obligatorio/);
  });

  it("permite múltiples super-admins con emails distintos", async () => {
    await upsertSuperAdmin(prisma, {
      email: "dani@tecnocloud.es",
      name: "Daniel",
      password: "otraContraseñaLargaXXX",
    });

    const total = await prisma.superAdmin.count();
    expect(total).toBe(2); // Alice + Daniel
  });
});
