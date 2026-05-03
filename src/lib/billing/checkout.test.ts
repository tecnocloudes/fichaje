import { describe, it, expect } from "vitest";
import { calculateQuantity } from "./checkout";

describe("calculateQuantity — per-seat con mínimo", () => {
  it("starter (4 €/emp, mín 39 €) → mínimo 10 seats", () => {
    expect(calculateQuantity(0, "starter")).toBe(10);
    expect(calculateQuantity(5, "starter")).toBe(10);
    expect(calculateQuantity(9, "starter")).toBe(10);
    expect(calculateQuantity(10, "starter")).toBe(10);
    expect(calculateQuantity(11, "starter")).toBe(11);
    expect(calculateQuantity(50, "starter")).toBe(50);
  });

  it("pro (5 €/emp, mín 49 €) → mínimo 10 seats", () => {
    // ceil(4900/500) = 10
    expect(calculateQuantity(0, "pro")).toBe(10);
    expect(calculateQuantity(7, "pro")).toBe(10);
    expect(calculateQuantity(10, "pro")).toBe(10);
    expect(calculateQuantity(20, "pro")).toBe(20);
    expect(calculateQuantity(50, "pro")).toBe(50);
  });

  it("enterprise (6 €/emp, mín 99 €) → mínimo 17 seats", () => {
    // ceil(9900/600) = 17 (16 × 6 = 96 < 99)
    expect(calculateQuantity(0, "enterprise")).toBe(17);
    expect(calculateQuantity(10, "enterprise")).toBe(17);
    expect(calculateQuantity(16, "enterprise")).toBe(17);
    expect(calculateQuantity(17, "enterprise")).toBe(17);
    expect(calculateQuantity(20, "enterprise")).toBe(20);
    expect(calculateQuantity(100, "enterprise")).toBe(100);
  });

  it("empleados negativos se tratan como 0 (defensivo)", () => {
    expect(calculateQuantity(-5, "starter")).toBe(10);
    expect(calculateQuantity(-1, "enterprise")).toBe(17);
  });
});
