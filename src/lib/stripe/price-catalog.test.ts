import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPlanPriceId,
  getAddonPriceId,
  matchPriceId,
  allPriceEnvKeys,
} from "./price-catalog";

const ORIG: Record<string, string | undefined> = {};

const ENV_KEYS = [
  "STRIPE_PRICE_STARTER_MONTHLY",
  "STRIPE_PRICE_STARTER_YEARLY",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_YEARLY",
  "STRIPE_PRICE_ENTERPRISE_MONTHLY",
  "STRIPE_PRICE_ENTERPRISE_YEARLY",
  "STRIPE_PRICE_ADDON_DOMINIO_PERSONALIZADO",
  "STRIPE_PRICE_ADDON_API_ACCESS",
];

describe("price-catalog", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      ORIG[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (ORIG[k] === undefined) delete process.env[k];
      else process.env[k] = ORIG[k];
    }
  });

  it("devuelve undefined si la env var no está", () => {
    expect(getPlanPriceId("starter", "monthly")).toBeUndefined();
    expect(getAddonPriceId("api_access")).toBeUndefined();
  });

  it("devuelve el price id si la env está", () => {
    process.env.STRIPE_PRICE_STARTER_MONTHLY = "price_test_starter_m";
    expect(getPlanPriceId("starter", "monthly")).toBe("price_test_starter_m");
  });

  it("matchPriceId resuelve plan correctamente", () => {
    process.env.STRIPE_PRICE_PRO_YEARLY = "price_pro_y";
    expect(matchPriceId("price_pro_y")).toEqual({
      kind: "plan",
      planKey: "pro",
      billingPeriod: "yearly",
    });
  });

  it("matchPriceId resuelve addon correctamente", () => {
    process.env.STRIPE_PRICE_ADDON_API_ACCESS = "price_addon_api";
    expect(matchPriceId("price_addon_api")).toEqual({
      kind: "addon",
      addonKey: "api_access",
    });
  });

  it("matchPriceId devuelve undefined si no coincide", () => {
    expect(matchPriceId("price_random_xyz")).toBeUndefined();
  });

  it("allPriceEnvKeys devuelve 13 keys (6 plans + 7 addons)", () => {
    expect(allPriceEnvKeys()).toHaveLength(13);
    expect(allPriceEnvKeys()).toContain("STRIPE_PRICE_STARTER_MONTHLY");
    expect(allPriceEnvKeys()).toContain("STRIPE_PRICE_ADDON_EMAILS_EXTRA");
  });

  it("ignora env vars vacías", () => {
    process.env.STRIPE_PRICE_STARTER_MONTHLY = "";
    expect(getPlanPriceId("starter", "monthly")).toBeUndefined();
  });
});
