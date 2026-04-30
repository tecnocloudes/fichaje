/**
 * Tests del wrapper de runtime hasFeature(key) / getLimit(key) que leen
 * de currentTenant().features (commit 15).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  hasFeature,
  getLimit,
  type ResolvedFeature,
  _setFeatureCatalogForTest,
  _resetFeatureCatalogForTest,
} from "./features";
import { runWithTenant, type TenantContext } from "./context";

function ctxWith(features: Map<string, ResolvedFeature>): TenantContext {
  return {
    tenantId: "tnt_test",
    slug: "test",
    status: "active",
    features,
  };
}

describe("hasFeature(key) (runtime wrapper)", () => {
  beforeEach(() => {
    _setFeatureCatalogForTest(["geofencing", "max_employees"]);
  });
  afterEach(() => {
    _resetFeatureCatalogForTest();
  });

  it("lee currentTenant().features dentro de runWithTenant", () => {
    const features = new Map<string, ResolvedFeature>([
      [
        "geofencing",
        { key: "geofencing", value: true, source: "plan", expiresAt: null },
      ],
    ]);
    runWithTenant(ctxWith(features), () => {
      expect(hasFeature("geofencing")).toBe(true);
    });
  });

  it("devuelve false si la feature no está", () => {
    const features = new Map<string, ResolvedFeature>();
    runWithTenant(ctxWith(features), () => {
      expect(hasFeature("geofencing")).toBe(false);
    });
  });

  it("lanza fuera de runWithTenant", () => {
    expect(() => hasFeature("geofencing")).toThrow(/No hay tenant/);
  });
});

describe("getLimit(key) (runtime wrapper)", () => {
  beforeEach(() => {
    _setFeatureCatalogForTest(["max_employees", "max_storage_mb"]);
  });
  afterEach(() => {
    _resetFeatureCatalogForTest();
  });

  it("devuelve el valor numérico", () => {
    const features = new Map<string, ResolvedFeature>([
      [
        "max_employees",
        { key: "max_employees", value: 25, source: "plan", expiresAt: null },
      ],
    ]);
    runWithTenant(ctxWith(features), () => {
      expect(getLimit("max_employees")).toBe(25);
    });
  });

  it("devuelve null si unlimited", () => {
    const features = new Map<string, ResolvedFeature>([
      [
        "max_storage_mb",
        { key: "max_storage_mb", value: null, source: "plan", expiresAt: null },
      ],
    ]);
    runWithTenant(ctxWith(features), () => {
      expect(getLimit("max_storage_mb")).toBeNull();
    });
  });

  it("devuelve 0 (fail-closed) si no aprovisionada", () => {
    runWithTenant(ctxWith(new Map()), () => {
      expect(getLimit("max_employees")).toBe(0);
    });
  });

  it("lanza fuera de runWithTenant", () => {
    expect(() => getLimit("max_employees")).toThrow(/No hay tenant/);
  });
});
