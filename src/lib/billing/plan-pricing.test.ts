import { describe, it, expect } from "vitest";
import {
  PLAN_PRICING,
  PLAN_ORDER,
  computeMonthlyCostCents,
  formatEuros,
} from "./plan-pricing";

describe("PLAN_PRICING — estructura definitiva 3 planes", () => {
  it("starter: 4 €/empleado, mínimo 39 €", () => {
    expect(PLAN_PRICING.starter.pricePerEmployeeCents).toBe(400);
    expect(PLAN_PRICING.starter.monthlyMinimumCents).toBe(3900);
    expect(PLAN_PRICING.starter.popular).toBe(false);
  });

  it("pro: 5 €/empleado, mínimo 49 €, popular", () => {
    expect(PLAN_PRICING.pro.pricePerEmployeeCents).toBe(500);
    expect(PLAN_PRICING.pro.monthlyMinimumCents).toBe(4900);
    expect(PLAN_PRICING.pro.popular).toBe(true);
  });

  it("enterprise: 6 €/empleado, mínimo 99 €", () => {
    expect(PLAN_PRICING.enterprise.pricePerEmployeeCents).toBe(600);
    expect(PLAN_PRICING.enterprise.monthlyMinimumCents).toBe(9900);
    expect(PLAN_PRICING.enterprise.popular).toBe(false);
  });

  it("orden visual starter → pro → enterprise", () => {
    expect(PLAN_ORDER).toEqual(["starter", "pro", "enterprise"]);
    const sorted = [...PLAN_ORDER].sort(
      (a, b) => PLAN_PRICING[a].sortOrder - PLAN_PRICING[b].sortOrder,
    );
    expect(sorted).toEqual(PLAN_ORDER);
  });
});

describe("computeMonthlyCostCents", () => {
  it("starter con 5 empleados → mínimo 39€ (5×4=20 < 39)", () => {
    expect(computeMonthlyCostCents("starter", 5)).toBe(3900);
  });
  it("starter con 10 empleados → 40€ > mínimo (es lo justo)", () => {
    // 10 × 400 = 4000 > 3900, gana el variable.
    expect(computeMonthlyCostCents("starter", 10)).toBe(4000);
  });
  it("pro con 0 empleados → mínimo 49€", () => {
    expect(computeMonthlyCostCents("pro", 0)).toBe(4900);
  });
  it("enterprise con 30 empleados → 180€ > mínimo 99€", () => {
    expect(computeMonthlyCostCents("enterprise", 30)).toBe(18000);
  });
  it("enterprise con 5 empleados → mínimo 99€ (5×6=30 < 99)", () => {
    expect(computeMonthlyCostCents("enterprise", 5)).toBe(9900);
  });
});

describe("formatEuros", () => {
  it("formatea entero con símbolo €", () => {
    expect(formatEuros(3900)).toMatch(/39\s*€/);
  });
  it("formatea decimal con coma", () => {
    expect(formatEuros(450)).toMatch(/4,50\s*€/);
  });
});
