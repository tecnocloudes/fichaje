import { describe, it, expect } from "vitest";
import {
  PLAN_PRICING,
  PLAN_ORDER,
  computeMonthlyCostCents,
  formatEuros,
  isPlanCompatible,
  recommendedPlan,
  rangeLabel,
} from "./plan-pricing";

describe("PLAN_PRICING — rangos no solapados con suelo por plan", () => {
  it("starter: 1-10 emp, 4 €/empleado, suelo 19 €", () => {
    expect(PLAN_PRICING.starter.pricePerEmployeeCents).toBe(400);
    expect(PLAN_PRICING.starter.monthlyMinimumCents).toBe(1900);
    expect(PLAN_PRICING.starter.minEmployees).toBe(1);
    expect(PLAN_PRICING.starter.maxEmployees).toBe(10);
    expect(PLAN_PRICING.starter.popular).toBe(false);
  });

  it("pro: 11-50 emp, 5 €/empleado, suelo 55 € = 11×5, popular", () => {
    expect(PLAN_PRICING.pro.pricePerEmployeeCents).toBe(500);
    expect(PLAN_PRICING.pro.monthlyMinimumCents).toBe(5500);
    expect(PLAN_PRICING.pro.minEmployees).toBe(11);
    expect(PLAN_PRICING.pro.maxEmployees).toBe(50);
    expect(PLAN_PRICING.pro.popular).toBe(true);
  });

  it("enterprise: 51+ emp, 6 €/empleado, suelo 306 € = 51×6", () => {
    expect(PLAN_PRICING.enterprise.pricePerEmployeeCents).toBe(600);
    expect(PLAN_PRICING.enterprise.monthlyMinimumCents).toBe(30600);
    expect(PLAN_PRICING.enterprise.minEmployees).toBe(51);
    expect(PLAN_PRICING.enterprise.maxEmployees).toBeNull();
    expect(PLAN_PRICING.enterprise.popular).toBe(false);
  });

  it("orden visual starter → pro → enterprise", () => {
    expect(PLAN_ORDER).toEqual(["starter", "pro", "enterprise"]);
    const sorted = [...PLAN_ORDER].sort(
      (a, b) => PLAN_PRICING[a].sortOrder - PLAN_PRICING[b].sortOrder,
    );
    expect(sorted).toEqual(PLAN_ORDER);
  });

  it("rangos no solapados: techo[N] ≤ suelo[N+1]", () => {
    // Starter techo (10×4=40) ≤ Pro suelo (55) ✓
    const starterTecho =
      PLAN_PRICING.starter.maxEmployees! *
      PLAN_PRICING.starter.pricePerEmployeeCents;
    expect(starterTecho).toBeLessThanOrEqual(
      PLAN_PRICING.pro.monthlyMinimumCents,
    );
    // Pro techo (50×5=250) ≤ Enterprise suelo (306) ✓
    const proTecho =
      PLAN_PRICING.pro.maxEmployees! *
      PLAN_PRICING.pro.pricePerEmployeeCents;
    expect(proTecho).toBeLessThanOrEqual(
      PLAN_PRICING.enterprise.monthlyMinimumCents,
    );
  });
});

describe("computeMonthlyCostCents", () => {
  it("starter con 3 empleados → suelo 19 € (3×4=12 < 19)", () => {
    expect(computeMonthlyCostCents("starter", 3)).toBe(1900);
  });
  it("starter con 5 empleados → 20 € (5×4=20 ≥ 19, gana variable)", () => {
    expect(computeMonthlyCostCents("starter", 5)).toBe(2000);
  });
  it("starter con 10 empleados (techo) → 40 €", () => {
    expect(computeMonthlyCostCents("starter", 10)).toBe(4000);
  });
  it("pro con 11 empleados (suelo) → 55 €", () => {
    expect(computeMonthlyCostCents("pro", 11)).toBe(5500);
  });
  it("pro con 30 empleados → 150 €", () => {
    expect(computeMonthlyCostCents("pro", 30)).toBe(15000);
  });
  it("pro con 50 empleados (techo) → 250 €", () => {
    expect(computeMonthlyCostCents("pro", 50)).toBe(25000);
  });
  it("enterprise con 51 empleados (suelo) → 306 €", () => {
    expect(computeMonthlyCostCents("enterprise", 51)).toBe(30600);
  });
  it("enterprise con 100 empleados → 600 €", () => {
    expect(computeMonthlyCostCents("enterprise", 100)).toBe(60000);
  });
});

describe("isPlanCompatible — empleados encajan en rango", () => {
  it("starter acepta 1-10", () => {
    expect(isPlanCompatible("starter", 1)).toBe(true);
    expect(isPlanCompatible("starter", 10)).toBe(true);
    expect(isPlanCompatible("starter", 11)).toBe(false);
    expect(isPlanCompatible("starter", 0)).toBe(false);
  });
  it("pro acepta 11-50", () => {
    expect(isPlanCompatible("pro", 10)).toBe(false);
    expect(isPlanCompatible("pro", 11)).toBe(true);
    expect(isPlanCompatible("pro", 50)).toBe(true);
    expect(isPlanCompatible("pro", 51)).toBe(false);
  });
  it("enterprise acepta 51+ sin tope", () => {
    expect(isPlanCompatible("enterprise", 50)).toBe(false);
    expect(isPlanCompatible("enterprise", 51)).toBe(true);
    expect(isPlanCompatible("enterprise", 5000)).toBe(true);
  });
});

describe("recommendedPlan", () => {
  it("0 empleados → starter (caso registro vacío)", () => {
    expect(recommendedPlan(0)).toBe("starter");
  });
  it("1-10 → starter", () => {
    expect(recommendedPlan(1)).toBe("starter");
    expect(recommendedPlan(10)).toBe("starter");
  });
  it("11-50 → pro", () => {
    expect(recommendedPlan(11)).toBe("pro");
    expect(recommendedPlan(30)).toBe("pro");
    expect(recommendedPlan(50)).toBe("pro");
  });
  it("51+ → enterprise", () => {
    expect(recommendedPlan(51)).toBe("enterprise");
    expect(recommendedPlan(500)).toBe("enterprise");
  });
});

describe("rangeLabel", () => {
  it("starter → '1-10 empleados'", () => {
    expect(rangeLabel("starter")).toBe("1-10 empleados");
  });
  it("pro → '11-50 empleados'", () => {
    expect(rangeLabel("pro")).toBe("11-50 empleados");
  });
  it("enterprise → 'Desde 51 empleados'", () => {
    expect(rangeLabel("enterprise")).toBe("Desde 51 empleados");
  });
});

describe("formatEuros", () => {
  it("formatea entero con símbolo €", () => {
    expect(formatEuros(1900)).toMatch(/19\s*€/);
  });
  it("formatea decimal con coma", () => {
    expect(formatEuros(450)).toMatch(/4,50\s*€/);
  });
});
