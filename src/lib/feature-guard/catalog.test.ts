/**
 * Tests del helper `ensureFeatureCatalogLoaded` y de la doble caché
 * (FeatureMeta tipado + Set<string> de keys conocidas).
 *
 * Bug detectado en bloque A (post-Fase 5): `loadFeatureCatalog()` en
 * features.ts nunca era llamado en runtime, así que cualquier
 * hasFeature/getLimit/consumeQuota lanzaba "FEATURE_CATALOG no cargado".
 * Fix: catalog.ts popula AMBAS cachés y withTenant lo invoca antes de
 * cada handler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prismaMaster: {
    feature: { findMany: vi.fn() },
  },
}));

import { prismaMaster } from "@/lib/prisma";
import {
  ensureFeatureCatalogLoaded,
  loadTypedFeatureCatalog,
  _resetTypedCatalogForTest,
} from "./catalog";
import {
  hasFeature,
  _resetFeatureCatalogForTest,
} from "@/lib/tenant/features";
import { runWithTenant } from "@/lib/tenant/context";

const featureFindMany = vi.mocked(prismaMaster.feature.findMany);

beforeEach(() => {
  _resetTypedCatalogForTest();
  _resetFeatureCatalogForTest();
  vi.clearAllMocks();
});

describe("ensureFeatureCatalogLoaded", () => {
  it("primera llamada hace 1 query a master.features", async () => {
    featureFindMany.mockResolvedValue([
      { key: "geofencing", type: "boolean", quotaPeriod: null },
      { key: "max_employees", type: "limit", quotaPeriod: null },
    ] as never);
    await ensureFeatureCatalogLoaded();
    expect(featureFindMany).toHaveBeenCalledTimes(1);
  });

  it("segunda llamada NO repite la query (idempotente)", async () => {
    featureFindMany.mockResolvedValue([
      { key: "geofencing", type: "boolean", quotaPeriod: null },
    ] as never);
    await ensureFeatureCatalogLoaded();
    await ensureFeatureCatalogLoaded();
    await ensureFeatureCatalogLoaded();
    expect(featureFindMany).toHaveBeenCalledTimes(1);
  });

  it("dos llamadas concurrentes deduplican la query (anti-stampede)", async () => {
    let resolveQuery!: (rows: unknown[]) => void;
    featureFindMany.mockReturnValue(
      new Promise((res) => {
        resolveQuery = res as (rows: unknown[]) => void;
      }) as never,
    );
    const p1 = ensureFeatureCatalogLoaded();
    const p2 = ensureFeatureCatalogLoaded();
    resolveQuery([
      { key: "geofencing", type: "boolean", quotaPeriod: null },
    ]);
    await Promise.all([p1, p2]);
    expect(featureFindMany).toHaveBeenCalledTimes(1);
  });

  it("tras cargar, hasFeature() funciona sin lanzar (ambas cachés pobladas)", async () => {
    featureFindMany.mockResolvedValue([
      { key: "geofencing", type: "boolean", quotaPeriod: null },
      { key: "export_csv", type: "boolean", quotaPeriod: null },
    ] as never);
    await ensureFeatureCatalogLoaded();

    const ctx = {
      tenantId: "t1",
      slug: "t1",
      status: "active" as const,
      features: new Map([
        [
          "geofencing",
          {
            key: "geofencing",
            value: true,
            source: "plan" as const,
            expiresAt: null,
          },
        ],
      ]),
    };
    const result = runWithTenant(ctx, () => hasFeature("geofencing"));
    expect(result).toBe(true);
    // Y feature en catálogo pero ausente en ctx.features → false sin lanzar.
    const result2 = runWithTenant(ctx, () => hasFeature("export_csv"));
    expect(result2).toBe(false);
  });
});

describe("loadTypedFeatureCatalog (caché propia)", () => {
  it("devuelve el mismo Map en llamadas sucesivas (no recarga)", async () => {
    featureFindMany.mockResolvedValue([
      { key: "geofencing", type: "boolean", quotaPeriod: null },
    ] as never);
    const a = await loadTypedFeatureCatalog();
    const b = await loadTypedFeatureCatalog();
    expect(a).toBe(b); // misma referencia
    expect(featureFindMany).toHaveBeenCalledTimes(1);
  });
});
