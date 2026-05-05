import { describe, it, expect } from "vitest";
import { calculateQuantity } from "./checkout";

describe("calculateQuantity — mínimo 15 usuarios facturables", () => {
  it("starter (4 €/usuario, mínimo 15 seats=60 €)", () => {
    expect(calculateQuantity(0, "starter")).toBe(15);
    expect(calculateQuantity(5, "starter")).toBe(15);
    expect(calculateQuantity(14, "starter")).toBe(15);
    expect(calculateQuantity(15, "starter")).toBe(15);
    expect(calculateQuantity(20, "starter")).toBe(20);
    expect(calculateQuantity(50, "starter")).toBe(50);
  });

  it("pro (5 €/usuario, mínimo 15 seats=75 €)", () => {
    expect(calculateQuantity(0, "pro")).toBe(15);
    expect(calculateQuantity(10, "pro")).toBe(15);
    expect(calculateQuantity(15, "pro")).toBe(15);
    expect(calculateQuantity(40, "pro")).toBe(40);
  });

  it("enterprise (6 €/usuario, mínimo 15 seats=90 €)", () => {
    expect(calculateQuantity(0, "enterprise")).toBe(15);
    expect(calculateQuantity(15, "enterprise")).toBe(15);
    expect(calculateQuantity(100, "enterprise")).toBe(100);
  });

  it("empleados negativos se tratan como 0 (defensivo)", () => {
    expect(calculateQuantity(-5, "starter")).toBe(15);
    expect(calculateQuantity(-1, "enterprise")).toBe(15);
  });
});
