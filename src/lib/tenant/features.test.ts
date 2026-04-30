/**
 * Tests unitarios de los helpers de features.
 *
 * Todos los tests son puros (sin BD): operan sobre Map<key, ResolvedFeature>
 * o sobre arrays de filas que `resolveFeatureRows` agrupa.
 *
 * Los tests con BD (getTenantBySlug, loadFeaturesFor con datos reales,
 * tests de aislamiento de roles, CHECK constraints) se materializan en
 * tests de integración con Testcontainers en una suite aparte (ADR-001
 * §2.4 propuesta provisional). Los stubs viven en
 * `features.integration.test.ts` con tag `integration` (Fase 9 los
 * implementa cuando el runner Vitest+Testcontainers esté listo).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  hasFeatureInMap as hasFeature,
  getLimitFromMap as getLimit,
  resolveFeatureRows,
  type ResolvedFeature,
  type FeatureSource,
  _setFeatureCatalogForTest,
  _resetFeatureCatalogForTest,
} from "./features";

const CATALOG = [
  "geofencing",
  "export_csv",
  "max_employees",
  "max_storage_mb",
  "emails_mes",
];

beforeEach(() => {
  _setFeatureCatalogForTest(CATALOG);
  vi.unstubAllEnvs();
});

afterEach(() => {
  _resetFeatureCatalogForTest();
});

// ─── hasFeature ───────────────────────────────────────────────────────────────

describe("hasFeature", () => {
  it("devuelve false cuando la feature no está aprovisionada", () => {
    const features = new Map<string, ResolvedFeature>();
    expect(hasFeature(features, "geofencing")).toBe(false);
  });

  it("devuelve true para feature plan=true", () => {
    const features = new Map<string, ResolvedFeature>([
      ["geofencing", { key: "geofencing", value: true, source: "plan", expiresAt: null }],
    ]);
    expect(hasFeature(features, "geofencing")).toBe(true);
  });

  it("devuelve false para feature plan=false", () => {
    const features = new Map<string, ResolvedFeature>([
      ["geofencing", { key: "geofencing", value: false, source: "plan", expiresAt: null }],
    ]);
    expect(hasFeature(features, "geofencing")).toBe(false);
  });

  it("manual_override=false gana sobre plan=true", () => {
    // Esto es lo que produce resolveFeatureRows cuando el override está
    // presente: el Map ya viene con el valor del override. Aquí simulamos
    // ese estado directamente.
    const features = new Map<string, ResolvedFeature>([
      [
        "geofencing",
        { key: "geofencing", value: false, source: "manual_override", expiresAt: null },
      ],
    ]);
    expect(hasFeature(features, "geofencing")).toBe(false);
  });

  it("lanza Error en dev cuando la key está fuera del catálogo", () => {
    vi.stubEnv("NODE_ENV", "development");
    const features = new Map<string, ResolvedFeature>();
    expect(() => hasFeature(features, "feature_inexistente")).toThrow(
      /feature_key desconocida/,
    );
  });

  it("devuelve false en producción cuando la key está fuera del catálogo", () => {
    vi.stubEnv("NODE_ENV", "production");
    const features = new Map<string, ResolvedFeature>();
    expect(hasFeature(features, "feature_inexistente")).toBe(false);
  });
});

// ─── getLimit ─────────────────────────────────────────────────────────────────

describe("getLimit", () => {
  it("devuelve 0 cuando la feature no está aprovisionada", () => {
    const features = new Map<string, ResolvedFeature>();
    expect(getLimit(features, "max_employees")).toBe(0);
  });

  it("devuelve el valor del plan cuando solo hay plan", () => {
    const features = new Map<string, ResolvedFeature>([
      ["max_employees", { key: "max_employees", value: 10, source: "plan", expiresAt: null }],
    ]);
    expect(getLimit(features, "max_employees")).toBe(10);
  });

  it("devuelve null para unlimited", () => {
    const features = new Map<string, ResolvedFeature>([
      ["max_employees", { key: "max_employees", value: null, source: "plan", expiresAt: null }],
    ]);
    expect(getLimit(features, "max_employees")).toBeNull();
  });

  it("devuelve el valor del manual_override (puede subir, ej. cortesía)", () => {
    const features = new Map<string, ResolvedFeature>([
      [
        "max_employees",
        { key: "max_employees", value: 100, source: "manual_override", expiresAt: null },
      ],
    ]);
    expect(getLimit(features, "max_employees")).toBe(100);
  });

  it("devuelve el valor del manual_override (puede bajar, ej. abuso)", () => {
    const features = new Map<string, ResolvedFeature>([
      [
        "max_employees",
        { key: "max_employees", value: 0, source: "manual_override", expiresAt: null },
      ],
    ]);
    expect(getLimit(features, "max_employees")).toBe(0);
  });

  it("lanza si se llama sobre feature boolean", () => {
    const features = new Map<string, ResolvedFeature>([
      ["geofencing", { key: "geofencing", value: true, source: "plan", expiresAt: null }],
    ]);
    expect(() => getLimit(features, "geofencing")).toThrow(/feature boolean/);
  });

  it("devuelve 0 en producción para key fuera del catálogo (fail-closed)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const features = new Map<string, ResolvedFeature>();
    expect(getLimit(features, "feature_inexistente")).toBe(0);
  });
});

// ─── resolveFeatureRows: combinación de fuentes ───────────────────────────────

describe("resolveFeatureRows", () => {
  it("plan + addon: suma para limits (regla refinada de ADR-003 §2.9)", () => {
    const rows = [
      {
        featureKey: "max_storage_mb",
        value: 5000 as number,
        source: "plan" as FeatureSource,
        expiresAt: null,
      },
      {
        featureKey: "max_storage_mb",
        value: 1000 as number,
        source: "addon" as FeatureSource,
        expiresAt: null,
      },
    ];
    const map = resolveFeatureRows(rows);
    expect(map.get("max_storage_mb")?.value).toBe(6000);
    expect(map.get("max_storage_mb")?.source).toBe("addon");
  });

  it("plan + 2 addons: suma de los tres", () => {
    const rows = [
      {
        featureKey: "emails_mes",
        value: 5000 as number,
        source: "plan" as FeatureSource,
        expiresAt: null,
      },
      {
        featureKey: "emails_mes",
        value: 1000 as number,
        source: "addon" as FeatureSource,
        expiresAt: null,
      },
      {
        featureKey: "emails_mes",
        value: 2000 as number,
        source: "addon" as FeatureSource,
        expiresAt: null,
      },
    ];
    const map = resolveFeatureRows(rows);
    expect(map.get("emails_mes")?.value).toBe(8000);
  });

  it("plan unlimited (null): el resultado es null aunque haya addons", () => {
    const rows = [
      {
        featureKey: "max_storage_mb",
        value: null,
        source: "plan" as FeatureSource,
        expiresAt: null,
      },
      {
        featureKey: "max_storage_mb",
        value: 1000 as number,
        source: "addon" as FeatureSource,
        expiresAt: null,
      },
    ];
    const map = resolveFeatureRows(rows);
    expect(map.get("max_storage_mb")?.value).toBeNull();
  });

  it("manual_override gana sobre plan + addons", () => {
    const rows = [
      {
        featureKey: "max_employees",
        value: 50 as number,
        source: "plan" as FeatureSource,
        expiresAt: null,
      },
      {
        featureKey: "max_employees",
        value: 25 as number,
        source: "addon" as FeatureSource,
        expiresAt: null,
      },
      {
        featureKey: "max_employees",
        value: 200 as number,
        source: "manual_override" as FeatureSource,
        expiresAt: null,
      },
    ];
    const map = resolveFeatureRows(rows);
    expect(map.get("max_employees")?.value).toBe(200);
    expect(map.get("max_employees")?.source).toBe("manual_override");
  });

  it("manual_override puede bajar el valor (caso restricción por abuso)", () => {
    const rows = [
      {
        featureKey: "max_employees",
        value: 50 as number,
        source: "plan" as FeatureSource,
        expiresAt: null,
      },
      {
        featureKey: "max_employees",
        value: 0 as number,
        source: "manual_override" as FeatureSource,
        expiresAt: null,
      },
    ];
    const map = resolveFeatureRows(rows);
    expect(map.get("max_employees")?.value).toBe(0);
  });

  it("OR entre plan=false y addon=true para boolean", () => {
    const rows = [
      {
        featureKey: "geofencing",
        value: false,
        source: "plan" as FeatureSource,
        expiresAt: null,
      },
      {
        featureKey: "geofencing",
        value: true,
        source: "addon" as FeatureSource,
        expiresAt: null,
      },
    ];
    const map = resolveFeatureRows(rows);
    expect(map.get("geofencing")?.value).toBe(true);
  });

  it("manual_override=false suprime addon=true", () => {
    const rows = [
      {
        featureKey: "geofencing",
        value: true,
        source: "addon" as FeatureSource,
        expiresAt: null,
      },
      {
        featureKey: "geofencing",
        value: false,
        source: "manual_override" as FeatureSource,
        expiresAt: null,
      },
    ];
    const map = resolveFeatureRows(rows);
    expect(map.get("geofencing")?.value).toBe(false);
  });

  it("expiresAt preserva la fecha más temprana entre fuentes", () => {
    const t1 = new Date("2026-12-31T00:00:00Z");
    const t2 = new Date("2027-01-15T00:00:00Z");
    const rows = [
      {
        featureKey: "max_employees",
        value: 50 as number,
        source: "plan" as FeatureSource,
        expiresAt: t2,
      },
      {
        featureKey: "max_employees",
        value: 10 as number,
        source: "addon" as FeatureSource,
        expiresAt: t1,
      },
    ];
    const map = resolveFeatureRows(rows);
    expect(map.get("max_employees")?.expiresAt).toEqual(t1);
  });
});
