/**
 * Tests del layer de idempotencia con Postgres real (Testcontainers).
 *
 * Verifica:
 *  - Primera vez con un event.id: recordEventOrSkip devuelve true.
 *  - Segunda vez con el mismo id: devuelve false (CONFLICT).
 *  - markProcessed actualiza processed_at.
 *  - markErrored escribe processing_error sin tocar processed_at.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { PrismaClient as PrismaClientMaster } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type Stripe from "stripe";

let container: StartedPostgreSqlContainer;
let prisma: PrismaClientMaster;

function fakeEvent(id: string, type: string = "checkout.session.completed"): Stripe.Event {
  // Cast directo: los tipos discriminados de Stripe.Event son demasiado
  // estrictos para construir manualmente; en tests basta con un Event-like.
  return {
    id,
    object: "event" as const,
    api_version: "2026-04-22.dahlia",
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object: {} },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  } as unknown as Stripe.Event;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_idem")
    .withUsername("postgres")
    .withPassword("test")
    .start();
  const connectionString = container.getConnectionUri();
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: "pipe",
  });
  // Override env para que prismaMaster use este container.
  process.env.MASTER_DATABASE_URL = connectionString;
  // Reset cliente cacheado (si existe globalmente).
  delete (globalThis as Record<string, unknown>).prismaMaster;
  prisma = new PrismaClientMaster({
    adapter: new PrismaPg({ connectionString }),
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
}, 30_000);

describe("recordEventOrSkip + markProcessed + markErrored", () => {
  it("primera vez devuelve true e inserta la fila", async () => {
    const { recordEventOrSkip } = await import("./idempotency");
    const ev = fakeEvent("evt_test_first");
    const fresh = await recordEventOrSkip(ev);
    expect(fresh).toBe(true);
    const row = await prisma.stripeEvent.findUnique({
      where: { eventId: "evt_test_first" },
    });
    expect(row).not.toBeNull();
    expect(row!.type).toBe("checkout.session.completed");
    expect(row!.processedAt).toBeNull();
    expect(row!.processingError).toBeNull();
  });

  it("segunda vez con mismo id devuelve false (CONFLICT)", async () => {
    const { recordEventOrSkip } = await import("./idempotency");
    const ev = fakeEvent("evt_test_first");
    const fresh = await recordEventOrSkip(ev);
    expect(fresh).toBe(false);
  });

  it("markProcessed actualiza processed_at", async () => {
    const { markProcessed } = await import("./idempotency");
    await markProcessed("evt_test_first");
    const row = await prisma.stripeEvent.findUnique({
      where: { eventId: "evt_test_first" },
    });
    expect(row!.processedAt).not.toBeNull();
  });

  it("markErrored escribe processing_error sin tocar processed_at", async () => {
    const { recordEventOrSkip, markErrored } = await import("./idempotency");
    const ev = fakeEvent("evt_test_err");
    await recordEventOrSkip(ev);
    await markErrored("evt_test_err", new Error("boom"));
    const row = await prisma.stripeEvent.findUnique({
      where: { eventId: "evt_test_err" },
    });
    expect(row!.processingError).toBe("boom");
    expect(row!.processedAt).toBeNull();
  });

  it("markErrored trunca mensajes >2000 chars", async () => {
    const { recordEventOrSkip, markErrored } = await import("./idempotency");
    const ev = fakeEvent("evt_test_long");
    await recordEventOrSkip(ev);
    const longMsg = "x".repeat(3000);
    await markErrored("evt_test_long", new Error(longMsg));
    const row = await prisma.stripeEvent.findUnique({
      where: { eventId: "evt_test_long" },
    });
    expect(row!.processingError!.length).toBe(2000);
  });

  it("eventos distintos coexisten", async () => {
    const { recordEventOrSkip } = await import("./idempotency");
    const a = fakeEvent("evt_test_a", "invoice.payment_succeeded");
    const b = fakeEvent("evt_test_b", "invoice.payment_failed");
    expect(await recordEventOrSkip(a)).toBe(true);
    expect(await recordEventOrSkip(b)).toBe(true);
    const total = await prisma.stripeEvent.count();
    // 4 insertados con éxito (first, err, long, a, b) — first+err+long+a+b = 5.
    expect(total).toBeGreaterThanOrEqual(5);
  });
});
