import { describe, it, expect } from "vitest";
import {
  PLAN_PRICING,
  PLAN_ORDER,
  MIN_BILLABLE_SEATS,
  computeMonthlyCostCents,
  formatEuros,
} from "./plan-pricing";

describe("PLAN_PRICING — mínimo único de 15 usuarios (modelo Sesame-like)", () => {
  it("MIN_BILLABLE_SEATS = 15", () => {
    expect(MIN_BILLABLE_SEATS).toBe(15);
  });

  it("starter: 4 €/usuario, mínimo 60 € = 15×4", () => {
    expect(PLAN_PRICING.starter.pricePerEmployeeCents).toBe(400);
    expect(PLAN_PRICING.starter.monthlyMinimumCents).toBe(6000);
    expect(PLAN_PRICING.starter.popular).toBe(false);
  });

  it("pro: 5 €/usuario, mínimo 75 € = 15×5, popular", () => {
    expect(PLAN_PRICING.pro.pricePerEmployeeCents).toBe(500);
    expect(PLAN_PRICING.pro.monthlyMinimumCents).toBe(7500);
    expect(PLAN_PRICING.pro.popular).toBe(true);
  });

  it("enterprise: 6 €/usuario, mínimo 90 € = 15×6", () => {
    expect(PLAN_PRICING.enterprise.pricePerEmployeeCents).toBe(600);
    expect(PLAN_PRICING.enterprise.monthlyMinimumCents).toBe(9000);
    expect(PLAN_PRICING.enterprise.popular).toBe(false);
  });

  it("orden visual starter → pro → enterprise", () => {
    expect(PLAN_ORDER).toEqual(["starter", "pro", "enterprise"]);
    const sorted = [...PLAN_ORDER].sort(
      (a, b) => PLAN_PRICING[a].sortOrder - PLAN_PRICING[b].sortOrder,
    );
    expect(sorted).toEqual(PLAN_ORDER);
  });

  it("monthlyMinimum = MIN_BILLABLE_SEATS × pricePerEmployee en todos los planes", () => {
    for (const key of PLAN_ORDER) {
      const p = PLAN_PRICING[key];
      expect(p.monthlyMinimumCents).toBe(MIN_BILLABLE_SEATS * p.pricePerEmployeeCents);
    }
  });
});

describe("computeMonthlyCostCents — aplica mínimo de 15 usuarios", () => {
  it("starter con 0 empleados → mínimo 60 € (15×4)", () => {
    expect(computeMonthlyCostCents("starter", 0)).toBe(6000);
  });
  it("starter con 5 empleados → 60 € (5 < 15, gana mínimo)", () => {
    expect(computeMonthlyCostCents("starter", 5)).toBe(6000);
  });
  it("starter con 14 empleados → 60 € (14 < 15, gana mínimo)", () => {
    expect(computeMonthlyCostCents("starter", 14)).toBe(6000);
  });
  it("starter con 15 empleados → 60 € (15×4)", () => {
    expect(computeMonthlyCostCents("starter", 15)).toBe(6000);
  });
  it("starter con 20 empleados → 80 € (20×4)", () => {
    expect(computeMonthlyCostCents("starter", 20)).toBe(8000);
  });
  it("pro con 0 empleados → 75 € (15×5)", () => {
    expect(computeMonthlyCostCents("pro", 0)).toBe(7500);
  });
  it("pro con 30 empleados → 150 € (30×5)", () => {
    expect(computeMonthlyCostCents("pro", 30)).toBe(15000);
  });
  it("enterprise con 0 empleados → 90 € (15×6)", () => {
    expect(computeMonthlyCostCents("enterprise", 0)).toBe(9000);
  });
  it("enterprise con 100 empleados → 600 € (100×6)", () => {
    expect(computeMonthlyCostCents("enterprise", 100)).toBe(60000);
  });
  it("empleados negativos se tratan como 0", () => {
    expect(computeMonthlyCostCents("starter", -5)).toBe(6000);
  });
});

describe("formatEuros", () => {
  it("formatea entero con símbolo €", () => {
    expect(formatEuros(6000)).toMatch(/60\s*€/);
  });
  it("formatea decimal con coma", () => {
    expect(formatEuros(450)).toMatch(/4,50\s*€/);
  });
});
