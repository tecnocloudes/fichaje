/**
 * Tests de los 2 jobs cron del worker. ADR-003 §5.2.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

let container: StartedPostgreSqlContainer;
let connectionString: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_jobs")
    .withUsername("postgres")
    .withPassword("test")
    .start();
  connectionString = container.getConnectionUri();
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: "pipe",
  });
  process.env.MASTER_DATABASE_URL = connectionString;
  delete (globalThis as Record<string, unknown>).prismaMaster;
}, 180_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

beforeEach(async () => {
  const { prismaMaster } = await import("@/lib/prisma");
  await prismaMaster.tenant.deleteMany({});
  await prismaMaster.stripeEvent.deleteMany({});
});

describe("cleanupPendingTenants", () => {
  it("borra tenants PENDING con created_at > 24h", async () => {
    const { prismaMaster } = await import("@/lib/prisma");
    const { cleanupPendingTenants } = await import("./cleanup-pending");

    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000);

    await prismaMaster.tenant.create({
      data: {
        id: "tnt_old",
        slug: "old1",
        name: "Old",
        email: "old@x",
        status: "pending",
        createdAt: oldDate,
        updatedAt: oldDate,
      },
    });
    await prismaMaster.tenant.create({
      data: {
        id: "tnt_recent",
        slug: "rec1",
        name: "Recent",
        email: "rec@x",
        status: "pending",
        createdAt: recentDate,
        updatedAt: recentDate,
      },
    });
    await prismaMaster.tenant.create({
      data: {
        id: "tnt_active_old",
        slug: "act1",
        name: "Active",
        email: "act@x",
        status: "active",
        createdAt: oldDate,
        updatedAt: oldDate,
      },
    });

    const deleted = await cleanupPendingTenants();
    expect(deleted).toBe(1); // solo tnt_old

    const remaining = await prismaMaster.tenant.count();
    expect(remaining).toBe(2);
    const stillThere = await prismaMaster.tenant.findMany({
      select: { id: true },
    });
    expect(stillThere.map((t) => t.id).sort()).toEqual([
      "tnt_active_old",
      "tnt_recent",
    ]);
  });

  it("no borra nada si no hay PENDING > 24h", async () => {
    const { prismaMaster } = await import("@/lib/prisma");
    const { cleanupPendingTenants } = await import("./cleanup-pending");
    await prismaMaster.tenant.create({
      data: {
        id: "tnt_new",
        slug: "new1",
        name: "New",
        email: "new@x",
        status: "pending",
        // createdAt = now por default
      },
    });
    const deleted = await cleanupPendingTenants();
    expect(deleted).toBe(0);
  });
});

describe("detectProvisioningStuck", () => {
  it("devuelve lista vacía si no hay PROVISIONING > 10 min", async () => {
    const { detectProvisioningStuck } = await import(
      "./detect-provisioning-stuck"
    );
    const stuck = await detectProvisioningStuck();
    expect(stuck).toEqual([]);
  });

  it("detecta PROVISIONING con updated_at > 10 min", async () => {
    const { prismaMaster } = await import("@/lib/prisma");
    const { detectProvisioningStuck } = await import(
      "./detect-provisioning-stuck"
    );
    const old = new Date(Date.now() - 15 * 60 * 1000);
    await prismaMaster.tenant.create({
      data: {
        id: "tnt_stuck",
        slug: "stuck1",
        name: "Stuck",
        email: "stuck@x",
        status: "provisioning",
        updatedAt: old,
        createdAt: old,
      },
    });
    const stuck = await detectProvisioningStuck();
    expect(stuck).toHaveLength(1);
    expect(stuck[0].slug).toBe("stuck1");
  });

  it("ignora PROVISIONING reciente (< 10 min)", async () => {
    const { prismaMaster } = await import("@/lib/prisma");
    const { detectProvisioningStuck } = await import(
      "./detect-provisioning-stuck"
    );
    await prismaMaster.tenant.create({
      data: {
        id: "tnt_recent_prov",
        slug: "rprov1",
        name: "Recent",
        email: "rp@x",
        status: "provisioning",
      },
    });
    const stuck = await detectProvisioningStuck();
    expect(stuck).toHaveLength(0);
  });
});
