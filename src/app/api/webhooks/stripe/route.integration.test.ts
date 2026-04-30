/**
 * Tests del webhook /api/webhooks/stripe con constructEvent REAL.
 * Enmienda 3 del plan de Fase 4 (parada 2).
 *
 * NUNCA mockear constructEvent ni la verificación de firma — eso
 * invalidaría el test de seguridad más importante del webhook.
 *
 * Sí mockeamos `stripe.subscriptions.retrieve` (requiere API real)
 * para devolver un objeto subscription consistente con el payload
 * del evento de test.
 *
 * Setup: Postgres efímero + seed master mínimo + 1 tenant PENDING +
 * env STRIPE_WEBHOOK_SECRET=whsec_test_dummy (aislado del de Stripe
 * CLI local del developer).
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import Stripe from "stripe";
import { NextRequest } from "next/server";

const TEST_WEBHOOK_SECRET = "whsec_test_dummy_secret_for_unit_tests";

let container: StartedPostgreSqlContainer;
let connectionString: string;
let pendingTenantId: string;
let stripeRaw: Stripe; // SDK directo para signing/constructEvent

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("fichaje_wh")
    .withUsername("postgres")
    .withPassword("test")
    .start();
  connectionString = container.getConnectionUri();
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: "pipe",
  });

  process.env.MASTER_DATABASE_URL = connectionString;
  process.env.APP_DATABASE_URL = connectionString;
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_route_test";
  delete (globalThis as Record<string, unknown>).prismaMaster;
  delete (globalThis as Record<string, unknown>).prismaApp;
  delete (globalThis as Record<string, unknown>)._tenantClients;

  // Seed mínimo: 1 plan starter con 1 PlanFeature.
  const { prismaMaster } = await import("@/lib/prisma");
  await prismaMaster.plan.create({
    data: {
      id: "plan_starter_id",
      key: "starter",
      name: "Starter",
      sortOrder: 0,
      active: true,
    },
  });
  await prismaMaster.feature.create({
    data: {
      id: "f_geo",
      key: "geofencing",
      name: "Geofencing",
      type: "boolean",
      active: true,
    },
  });
  await prismaMaster.planFeature.create({
    data: {
      id: "pf_starter_geo",
      planId: "plan_starter_id",
      featureKey: "geofencing",
      value: true as never,
    },
  });

  // Tenant PENDING para el escenario checkout.completed.
  const tenant = await prismaMaster.tenant.create({
    data: {
      slug: "acmewh",
      name: "Acme",
      email: "owner@acmewh.local",
      status: "pending",
    },
  });
  pendingTenantId = tenant.id;

  // Cliente Stripe directo para firmar payloads (no usa el singleton —
  // necesitamos llamar a webhooks.generateTestHeaderString sin pasar
  // por env STRIPE_SECRET_KEY paranoico).
  stripeRaw = new Stripe("sk_test_dummy_for_route_test", {
    apiVersion: "2026-04-22.dahlia",
  });
}, 180_000);

afterAll(async () => {
  await container?.stop();
}, 30_000);

beforeEach(() => {
  // Mock de stripe.subscriptions.retrieve para devolver un objeto
  // subscription consistente con el payload del evento de test.
  // NO tocamos webhooks.constructEvent — sigue real.
});

function buildSignedRequest(
  payload: Record<string, unknown>,
  opts: { tamperSignature?: boolean } = {},
): NextRequest {
  const body = JSON.stringify(payload);
  let signature = stripeRaw.webhooks.generateTestHeaderString({
    payload: body,
    secret: TEST_WEBHOOK_SECRET,
  });
  if (opts.tamperSignature) {
    // Cambiamos el último char del signature para invalidarlo.
    signature = signature.slice(0, -1) + (signature.slice(-1) === "0" ? "1" : "0");
  }
  return new NextRequest("http://app.localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "stripe-signature": signature,
      "content-type": "application/json",
    },
    body,
  });
}

describe("/api/webhooks/stripe — verificación de firma + idempotencia", () => {
  it("rechaza con 400 si falta header stripe-signature", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest(
      "http://app.localhost:3000/api/webhooks/stripe",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "evt_no_sig", type: "ping" }),
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Missing signature");
  });

  it("rechaza con 400 si la firma es inválida (tampered)", async () => {
    const { POST } = await import("./route");
    const payload = makeFakeEventPayload("evt_bad_sig", "checkout.session.expired");
    const req = buildSignedRequest(payload, { tamperSignature: true });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid signature");
  });

  it("acepta evento bien firmado y registra en stripe_events", async () => {
    const { POST } = await import("./route");
    const payload = makeFakeEventPayload(
      "evt_test_expired",
      "checkout.session.expired",
    );
    const req = buildSignedRequest(payload);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const { prismaMaster } = await import("@/lib/prisma");
    const row = await prismaMaster.stripeEvent.findUnique({
      where: { eventId: "evt_test_expired" },
    });
    expect(row).not.toBeNull();
    expect(row!.processedAt).not.toBeNull();
  });

  it("replay del mismo event.id devuelve 200 sin re-procesar", async () => {
    const { POST } = await import("./route");
    const payload = makeFakeEventPayload(
      "evt_test_expired",
      "checkout.session.expired",
    );
    const req = buildSignedRequest(payload);
    const res = await POST(req);
    expect(res.status).toBe(200);
    // Sigue habiendo solo 1 fila para ese event_id.
    const { prismaMaster } = await import("@/lib/prisma");
    const count = await prismaMaster.stripeEvent.count({
      where: { eventId: "evt_test_expired" },
    });
    expect(count).toBe(1);
  });
});

describe("/api/webhooks/stripe — checkout.session.completed (coreografía)", () => {
  it("PENDING tenant → ACTIVE tras checkout.session.completed", async () => {
    // Mock de stripe.subscriptions.retrieve.
    const { stripe: stripeSingleton } = await import("@/lib/stripe/client");
    const fakeSubscription: Stripe.Subscription = {
      id: "sub_test_acmewh",
      customer: "cus_test_acmewh",
      status: "active",
      cancel_at_period_end: false,
      trial_end: null,
      items: {
        object: "list",
        data: [
          {
            id: "si_test_acmewh",
            object: "subscription_item",
            price: { id: "price_starter_m", object: "price" },
            quantity: 1,
          } as unknown as Stripe.SubscriptionItem,
        ],
        has_more: false,
        url: "/v1/subscription_items",
      },
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    } as unknown as Stripe.Subscription;
    process.env.STRIPE_PRICE_STARTER_MONTHLY = "price_starter_m";
    vi.spyOn(stripeSingleton.subscriptions, "retrieve").mockResolvedValue(
      fakeSubscription as never,
    );

    const { POST } = await import("./route");
    const payload = {
      id: "evt_checkout_acmewh",
      object: "event",
      type: "checkout.session.completed",
      api_version: "2026-04-22.dahlia",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: {
        object: {
          id: "cs_test_acmewh",
          object: "checkout.session",
          client_reference_id: pendingTenantId,
          customer: "cus_test_acmewh",
          subscription: "sub_test_acmewh",
        },
      },
    };
    const req = buildSignedRequest(payload);
    const res = await POST(req);
    expect(res.status).toBe(200);

    const { prismaMaster } = await import("@/lib/prisma");
    const tenant = await prismaMaster.tenant.findUnique({
      where: { id: pendingTenantId },
    });
    expect(tenant!.status).toBe("active");
    expect(tenant!.stripeCustomerId).toBe("cus_test_acmewh");
    const sub = await prismaMaster.subscription.findUnique({
      where: { stripeSubscriptionId: "sub_test_acmewh" },
    });
    expect(sub).not.toBeNull();
    expect(sub!.planKey).toBe("starter");
  });
});

function makeFakeEventPayload(id: string, type: string): Record<string, unknown> {
  return {
    id,
    object: "event",
    type,
    api_version: "2026-04-22.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: { object: {} },
  };
}
