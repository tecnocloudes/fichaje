import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getCachedTenant,
  setCachedHit,
  setCachedMiss,
  _resetCache,
  _cacheSize,
} from "./cache";
import type { TenantContext } from "./context";

const baseCtx: TenantContext = {
  tenantId: "ckxxx",
  slug: "acme",
  status: "active",
  features: new Map(),
};

describe("tenant cache", () => {
  beforeEach(() => {
    _resetCache();
    delete process.env.TENANT_CACHE_TTL_MS;
    delete process.env.TENANT_NEGATIVE_CACHE_TTL_MS;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hit positivo se devuelve dentro del TTL", () => {
    setCachedHit("acme.ficha.tecnocloud.es", baseCtx);
    const r = getCachedTenant("acme.ficha.tecnocloud.es");
    expect(r).toEqual({ kind: "hit", ctx: baseCtx });
  });

  it("hit negativo se devuelve dentro del TTL", () => {
    setCachedMiss("zzz.ficha.tecnocloud.es", "no existe");
    const r = getCachedTenant("zzz.ficha.tecnocloud.es");
    expect(r).toEqual({ kind: "miss", reason: "no existe" });
  });

  it("miss sin entrada devuelve undefined", () => {
    expect(getCachedTenant("nada.ficha.tecnocloud.es")).toBeUndefined();
  });

  it("expira hit positivo tras TTL", () => {
    process.env.TENANT_CACHE_TTL_MS = "100";
    setCachedHit("acme.ficha.tecnocloud.es", baseCtx);
    expect(getCachedTenant("acme.ficha.tecnocloud.es")).toBeDefined();
    vi.useFakeTimers();
    vi.advanceTimersByTime(150);
    expect(getCachedTenant("acme.ficha.tecnocloud.es")).toBeUndefined();
  });

  it("expira hit negativo tras TTL más corto", () => {
    process.env.TENANT_NEGATIVE_CACHE_TTL_MS = "50";
    setCachedMiss("zzz.ficha.tecnocloud.es", "no existe");
    expect(getCachedTenant("zzz.ficha.tecnocloud.es")).toBeDefined();
    vi.useFakeTimers();
    vi.advanceTimersByTime(80);
    expect(getCachedTenant("zzz.ficha.tecnocloud.es")).toBeUndefined();
  });

  it("setear hit sobre miss reemplaza la entrada", () => {
    setCachedMiss("acme.ficha.tecnocloud.es", "todavía no existe");
    setCachedHit("acme.ficha.tecnocloud.es", baseCtx);
    expect(getCachedTenant("acme.ficha.tecnocloud.es")).toEqual({
      kind: "hit",
      ctx: baseCtx,
    });
  });

  it("_resetCache limpia todo", () => {
    setCachedHit("a", baseCtx);
    setCachedHit("b", baseCtx);
    setCachedMiss("c", "x");
    expect(_cacheSize()).toBe(3);
    _resetCache();
    expect(_cacheSize()).toBe(0);
  });

  it("ignora valores no numéricos en TENANT_CACHE_TTL_MS (cae al default)", () => {
    process.env.TENANT_CACHE_TTL_MS = "invalid";
    setCachedHit("acme", baseCtx);
    // Con TTL default 60s, sigue válido a los 100ms.
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    expect(getCachedTenant("acme")).toBeDefined();
  });
});
