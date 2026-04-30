/**
 * Tests puros de runWithTenant + currentTenant (sin BD).
 *
 * Verifica:
 * - currentTenant() lanza fuera de runWithTenant.
 * - runWithTenant propaga el contexto sincrónica y asíncronamente.
 * - Reanidar runWithTenant cambia el contexto.
 * - maybeCurrentTenant devuelve undefined fuera de runWithTenant.
 */

import { describe, it, expect } from "vitest";
import {
  runWithTenant,
  currentTenant,
  maybeCurrentTenant,
  type TenantContext,
} from "./context";

const baseCtx: TenantContext = {
  tenantId: "ckxxxxxxxxxxxxxxxxxxx",
  slug: "acme",
  status: "active",
  features: new Map(),
};

describe("currentTenant / runWithTenant", () => {
  it("currentTenant() lanza fuera de runWithTenant", () => {
    expect(() => currentTenant()).toThrow(/No hay tenant/);
  });

  it("maybeCurrentTenant() devuelve undefined fuera de runWithTenant", () => {
    expect(maybeCurrentTenant()).toBeUndefined();
  });

  it("runWithTenant propaga el contexto sincrónamente", () => {
    runWithTenant(baseCtx, () => {
      const ctx = currentTenant();
      expect(ctx.slug).toBe("acme");
      expect(ctx.tenantId).toBe(baseCtx.tenantId);
      expect(ctx.status).toBe("active");
    });
  });

  it("runWithTenant propaga el contexto a través de await", async () => {
    await runWithTenant(baseCtx, async () => {
      await Promise.resolve();
      const ctx = currentTenant();
      expect(ctx.slug).toBe("acme");
    });
  });

  it("contexto se restaura al salir de runWithTenant", () => {
    runWithTenant(baseCtx, () => {
      expect(currentTenant().slug).toBe("acme");
    });
    expect(() => currentTenant()).toThrow(/No hay tenant/);
  });

  it("reanidar runWithTenant cambia el contexto en el bloque interno", () => {
    runWithTenant(baseCtx, () => {
      expect(currentTenant().slug).toBe("acme");

      const innerCtx: TenantContext = {
        ...baseCtx,
        slug: "umbrella",
        tenantId: "cl000000000000000000",
      };
      runWithTenant(innerCtx, () => {
        expect(currentTenant().slug).toBe("umbrella");
      });

      // Restaurado al salir del bloque interno.
      expect(currentTenant().slug).toBe("acme");
    });
  });

  it("contextos paralelos no se contaminan entre sí", async () => {
    const ctxA: TenantContext = { ...baseCtx, slug: "acme" };
    const ctxB: TenantContext = { ...baseCtx, slug: "umbrella", tenantId: "cl0" };

    const taskA = runWithTenant(ctxA, async () => {
      await Promise.resolve();
      return currentTenant().slug;
    });
    const taskB = runWithTenant(ctxB, async () => {
      await new Promise((r) => setTimeout(r, 10));
      return currentTenant().slug;
    });

    const [a, b] = await Promise.all([taskA, taskB]);
    expect(a).toBe("acme");
    expect(b).toBe("umbrella");
  });

  it("runWithTenant devuelve el valor de fn", () => {
    const result = runWithTenant(baseCtx, () => 42);
    expect(result).toBe(42);
  });

  it("runWithTenant propaga el rejection de la promesa de fn", async () => {
    await expect(
      runWithTenant(baseCtx, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
