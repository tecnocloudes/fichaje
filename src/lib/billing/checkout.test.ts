import { describe, it, expect } from "vitest";
import { calculateQuantity } from "./checkout";

describe("calculateQuantity — per-seat con suelo por plan", () => {
  it("starter (4 €/emp, suelo 19 €) → mínimo 5 seats (ceil(19/4))", () => {
    expect(calculateQuantity(0, "starter")).toBe(5);
    expect(calculateQuantity(3, "starter")).toBe(5);
    expect(calculateQuantity(5, "starter")).toBe(5);
    expect(calculateQuantity(7, "starter")).toBe(7);
    expect(calculateQuantity(10, "starter")).toBe(10);
  });

  it("pro (5 €/emp, suelo 55 € = 11 seats) → mínimo 11 seats", () => {
    // ceil(5500/500) = 11 — coincide con minEmployees del rango.
    expect(calculateQuantity(0, "pro")).toBe(11);
    expect(calculateQuantity(11, "pro")).toBe(11);
    expect(calculateQuantity(30, "pro")).toBe(30);
    expect(calculateQuantity(50, "pro")).toBe(50);
  });

  it("enterprise (6 €/emp, suelo 306 € = 51 seats) → mínimo 51 seats", () => {
    // ceil(30600/600) = 51 — coincide con minEmployees del rango.
    expect(calculateQuantity(0, "enterprise")).toBe(51);
    expect(calculateQuantity(50, "enterprise")).toBe(51);
    expect(calculateQuantity(51, "enterprise")).toBe(51);
    expect(calculateQuantity(100, "enterprise")).toBe(100);
  });

  it("empleados negativos se tratan como 0 (defensivo)", () => {
    expect(calculateQuantity(-5, "starter")).toBe(5);
    expect(calculateQuantity(-1, "enterprise")).toBe(51);
  });
});
