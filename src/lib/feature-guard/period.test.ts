import { describe, it, expect } from "vitest";
import {
  computeCurrentPeriod,
  isQuotaPeriod,
} from "@/lib/feature-guard/period";

describe("computeCurrentPeriod", () => {
  it("mes: devuelve 1er día del mes hasta 1er día del siguiente", () => {
    const now = new Date(2026, 3, 15, 14, 30); // 15-abr-2026 14:30 local
    const { start, end } = computeCurrentPeriod("mes", now);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3); // abril
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(4); // mayo
    expect(end.getDate()).toBe(1);
    expect(end.getHours()).toBe(0);
  });

  it("mes: cruce de año desde diciembre a enero", () => {
    const now = new Date(2026, 11, 31, 23, 59);
    const { start, end } = computeCurrentPeriod("mes", now);
    expect(start.getMonth()).toBe(11);
    expect(start.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(0);
    expect(end.getFullYear()).toBe(2027);
  });

  it("dia: devuelve 00:00 hoy hasta 00:00 mañana", () => {
    const now = new Date(2026, 3, 15, 14, 30);
    const { start, end } = computeCurrentPeriod("dia", now);
    expect(start.getDate()).toBe(15);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getDate()).toBe(16);
    expect(end.getHours()).toBe(0);
  });

  it("dia: cruce de mes (último día → día 1)", () => {
    const now = new Date(2026, 3, 30, 23, 0); // 30-abr 23:00
    const { start, end } = computeCurrentPeriod("dia", now);
    expect(start.getDate()).toBe(30);
    expect(start.getMonth()).toBe(3);
    expect(end.getDate()).toBe(1);
    expect(end.getMonth()).toBe(4); // mayo
  });

  it("período no soportado lanza", () => {
    expect(() =>
      computeCurrentPeriod("anio" as unknown as "mes"),
    ).toThrow(/no soportado/);
  });
});

describe("isQuotaPeriod", () => {
  it("acepta solo 'mes' o 'dia'", () => {
    expect(isQuotaPeriod("mes")).toBe(true);
    expect(isQuotaPeriod("dia")).toBe(true);
    expect(isQuotaPeriod(null)).toBe(false);
    expect(isQuotaPeriod(undefined)).toBe(false);
    expect(isQuotaPeriod("monthly")).toBe(false);
    expect(isQuotaPeriod("")).toBe(false);
    expect(isQuotaPeriod(0)).toBe(false);
  });
});
