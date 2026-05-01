/**
 * test:feature-coverage — verifica que cada feature key del catálogo
 * §11.4 (32 entries) está cubierta en FEATURE_COVERAGE.
 *
 * Plan Fase 5 §7.5 + §15.4 (falla CI si feature no envuelta).
 *
 * Cobertura mínima: cada feature debe aparecer al menos una vez en
 * FEATURE_COVERAGE, ya sea apuntando a un archivo real, a un marker
 * (__platform__/__email__/__push__/__informative__/__ui_gate__) o
 * marcada como `deferred: true` (endpoint planeado Fase 6+).
 *
 * Coherencia adicional:
 *  - Si guard='withQuota', `quotaAmount` debe estar definido y > 0.
 *  - Si endpointGlob NO es marker (`__X__`) Y NO es deferred, el
 *    archivo debe existir en disco (relativo a src/app/api/).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { FEATURE_COVERAGE } from "./coverage";

const SEED_PATH = path.resolve(
  process.cwd(),
  "prisma",
  "seeds",
  "master.ts",
);

/** Extrae las claves de feature definidas en el seed master.ts. */
function loadCatalogKeys(): string[] {
  const src = readFileSync(SEED_PATH, "utf8");
  const keys: string[] = [];
  // Match { key: "xxx", ... type: "boolean" | "limit" | "quota" }
  const re = /\{\s*key:\s*"([^"]+)"[^}]*type:\s*"(boolean|limit|quota)"/g;
  for (const m of src.matchAll(re)) {
    keys.push(m[1]!);
  }
  return keys;
}

describe("feature-coverage", () => {
  const catalogKeys = loadCatalogKeys();

  it("seed master.ts define al menos 30 features", () => {
    expect(catalogKeys.length).toBeGreaterThanOrEqual(30);
  });

  it("toda feature del catálogo aparece en FEATURE_COVERAGE", () => {
    const covered = new Set(FEATURE_COVERAGE.map((c) => c.featureKey));
    const missing = catalogKeys.filter((k) => !covered.has(k));
    expect(missing, `Features no cubiertas: ${JSON.stringify(missing)}`).toEqual(
      [],
    );
  });

  it("toda entry de FEATURE_COVERAGE corresponde a feature del catálogo", () => {
    const known = new Set(catalogKeys);
    const stray = FEATURE_COVERAGE.filter((c) => !known.has(c.featureKey));
    expect(
      stray.map((c) => c.featureKey),
      `Entries sobrantes (no en catálogo): ${JSON.stringify(stray.map((c) => c.featureKey))}`,
    ).toEqual([]);
  });

  it("guard='withQuota' implica quotaAmount > 0", () => {
    for (const c of FEATURE_COVERAGE) {
      if (c.guard !== "withQuota") continue;
      expect(c.quotaAmount, `${c.featureKey} sin quotaAmount`).toBeGreaterThan(0);
    }
  });

  it("endpointGlob no marker y no deferred → archivo existe en disco", () => {
    const failures: string[] = [];
    for (const c of FEATURE_COVERAGE) {
      if (c.deferred) continue;
      if (c.endpointGlob.startsWith("__")) continue;
      // Glob simple: si contiene **, verificar que el directorio padre exista
      // y que al menos un route.ts coincida.
      const apiBase = path.resolve(process.cwd(), "src", "app", "api");
      const hasGlob = c.endpointGlob.includes("**");
      if (hasGlob) {
        const dir = c.endpointGlob.split("/**/")[0];
        const target = path.join(apiBase, dir);
        if (!existsSync(target)) {
          failures.push(`${c.featureKey} → ${c.endpointGlob} (dir no existe: ${target})`);
        }
      } else {
        const target = path.join(apiBase, c.endpointGlob);
        if (!existsSync(target)) {
          failures.push(`${c.featureKey} → ${c.endpointGlob} (archivo no existe: ${target})`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
