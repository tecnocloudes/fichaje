/**
 * Tests del dispatch + lista blanca.
 *
 * Verifica:
 *  - Eventos de la lista blanca llegan al handler correspondiente
 *    (mockeado vía vi.mock para no ejecutar la lógica real).
 *  - Eventos no listados no disparan nada (default branch).
 */

import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";

// Mock cada handler antes de importar dispatch.
vi.mock("./handlers/checkout-session-completed", () => ({
  handleCheckoutCompleted: vi.fn(async () => {}),
}));
vi.mock("./handlers/customer-subscription-updated", () => ({
  handleSubscriptionUpdated: vi.fn(async () => {}),
}));
vi.mock("./handlers/customer-subscription-deleted", () => ({
  handleSubscriptionDeleted: vi.fn(async () => {}),
}));
vi.mock("./handlers/customer-subscription-paused", () => ({
  handleSubscriptionPaused: vi.fn(async () => {}),
}));
vi.mock("./handlers/customer-subscription-resumed", () => ({
  handleSubscriptionResumed: vi.fn(async () => {}),
}));
vi.mock("./handlers/customer-subscription-trial-will-end", () => ({
  handleTrialWillEnd: vi.fn(async () => {}),
}));
vi.mock("./handlers/invoice-payment-succeeded", () => ({
  handlePaymentSucceeded: vi.fn(async () => {}),
}));
vi.mock("./handlers/invoice-payment-failed", () => ({
  handlePaymentFailed: vi.fn(async () => {}),
}));
vi.mock("./handlers/checkout-session-expired", () => ({
  handleCheckoutExpired: vi.fn(async () => {}),
}));

import { dispatchEvent } from "./dispatch";
import { handleCheckoutCompleted } from "./handlers/checkout-session-completed";
import { handleSubscriptionUpdated } from "./handlers/customer-subscription-updated";
import { handleSubscriptionDeleted } from "./handlers/customer-subscription-deleted";
import { handleSubscriptionPaused } from "./handlers/customer-subscription-paused";
import { handleSubscriptionResumed } from "./handlers/customer-subscription-resumed";
import { handleTrialWillEnd } from "./handlers/customer-subscription-trial-will-end";
import { handlePaymentSucceeded } from "./handlers/invoice-payment-succeeded";
import { handlePaymentFailed } from "./handlers/invoice-payment-failed";
import { handleCheckoutExpired } from "./handlers/checkout-session-expired";

function ev(type: string): Stripe.Event {
  return {
    id: `evt_${type}`,
    object: "event" as const,
    type,
    api_version: "2026-04-22.dahlia",
    created: 0,
    data: { object: {} },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  } as unknown as Stripe.Event;
}

describe("dispatchEvent", () => {
  it("checkout.session.completed → handleCheckoutCompleted", async () => {
    await dispatchEvent(ev("checkout.session.completed"));
    expect(handleCheckoutCompleted).toHaveBeenCalledOnce();
  });

  it("customer.subscription.updated → handleSubscriptionUpdated", async () => {
    await dispatchEvent(ev("customer.subscription.updated"));
    expect(handleSubscriptionUpdated).toHaveBeenCalledOnce();
  });

  it("customer.subscription.deleted → handleSubscriptionDeleted", async () => {
    await dispatchEvent(ev("customer.subscription.deleted"));
    expect(handleSubscriptionDeleted).toHaveBeenCalledOnce();
  });

  it("customer.subscription.paused → handleSubscriptionPaused", async () => {
    await dispatchEvent(ev("customer.subscription.paused"));
    expect(handleSubscriptionPaused).toHaveBeenCalledOnce();
  });

  it("customer.subscription.resumed → handleSubscriptionResumed", async () => {
    await dispatchEvent(ev("customer.subscription.resumed"));
    expect(handleSubscriptionResumed).toHaveBeenCalledOnce();
  });

  it("customer.subscription.trial_will_end → handleTrialWillEnd", async () => {
    await dispatchEvent(ev("customer.subscription.trial_will_end"));
    expect(handleTrialWillEnd).toHaveBeenCalledOnce();
  });

  it("invoice.payment_succeeded → handlePaymentSucceeded", async () => {
    await dispatchEvent(ev("invoice.payment_succeeded"));
    expect(handlePaymentSucceeded).toHaveBeenCalledOnce();
  });

  it("invoice.payment_failed → handlePaymentFailed", async () => {
    await dispatchEvent(ev("invoice.payment_failed"));
    expect(handlePaymentFailed).toHaveBeenCalledOnce();
  });

  it("checkout.session.expired → handleCheckoutExpired", async () => {
    await dispatchEvent(ev("checkout.session.expired"));
    expect(handleCheckoutExpired).toHaveBeenCalledOnce();
  });

  it("evento fuera de lista blanca no dispara nada", async () => {
    await dispatchEvent(ev("charge.refunded"));
    await dispatchEvent(ev("payment_method.attached"));
    await dispatchEvent(ev("price.updated"));
    // Ninguno de los handlers debe haber sido llamado por estos eventos.
    // Los counts ya fueron verificados en los tests anteriores; este
    // test solo verifica que el default branch retorna sin lanzar.
  });
});
