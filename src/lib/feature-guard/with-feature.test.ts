import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { withFeature } from "./with-feature";
import { runWithTenant, type TenantContext } from "@/lib/tenant/context";
import {
  _setFeatureCatalogForTest,
  _resetFeatureCatalogForTest,
} from "@/lib/tenant/features";

const ACTIVE_CTX: TenantContext = {
  tenantId: "tnt_test",
  slug: "test",
  status: "active",
  features: new Map([
    ["export_csv", { key: "export_csv", value: true, source: "plan", expiresAt: null }],
  ]),
};

const CTX_WITHOUT_FEATURE: TenantContext = {
  ...ACTIVE_CTX,
  features: new Map([
    ["export_csv", { key: "export_csv", value: false, source: "plan", expiresAt: null }],
  ]),
};

function makeReq(): NextRequest {
  return new NextRequest("http://test.localhost:3000/api/x", {
    headers: { host: "test.localhost:3000" },
  });
}

beforeEach(() => {
  _setFeatureCatalogForTest(["export_csv", "api_access"]);
});
afterEach(() => {
  _resetFeatureCatalogForTest();
});

describe("withFeature", () => {
  it("invoca el handler si la feature está activa", async () => {
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const wrapped = withFeature("export_csv", handler);
    const res = await runWithTenant(ACTIVE_CTX, () => wrapped(makeReq()));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("devuelve 402 con feature_key y upgrade_url si la feature está OFF", async () => {
    const handler = vi.fn();
    const wrapped = withFeature("export_csv", handler);
    const res = await runWithTenant(CTX_WITHOUT_FEATURE, () => wrapped(makeReq()));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toEqual({
      error: "feature_required",
      feature_key: "export_csv",
      upgrade_url: "/admin/configuracion/facturacion?upgrade=export_csv",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("devuelve 402 si la feature no está en el Map", async () => {
    const handler = vi.fn();
    const wrapped = withFeature("export_csv", handler);
    const ctx: TenantContext = { ...ACTIVE_CTX, features: new Map() };
    const res = await runWithTenant(ctx, () => wrapped(makeReq()));
    expect(res.status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
  });

  // Enmienda 2 — test del orden de composición:
  it("aplicado fuera de runWithTenant lanza con mensaje útil", async () => {
    const handler = vi.fn();
    const wrapped = withFeature("export_csv", handler);
    await expect(wrapped(makeReq())).rejects.toThrow(/No hay tenant/);
    expect(handler).not.toHaveBeenCalled();
  });
});
