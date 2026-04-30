/**
 * Tests del HOF withTenant. Mockea resolveTenant + getToken; el handler
 * usa currentTenant() para verificar que el contexto está activo cuando
 * se invoca.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { ResolveResult } from "./resolver";
import type { TenantContext } from "./context";
import { currentTenant } from "./context";

vi.mock("./resolver", () => ({
  resolveTenant: vi.fn(),
}));
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

import { resolveTenant } from "./resolver";
import { getToken } from "next-auth/jwt";
import { withTenant } from "./with-tenant";

const ACTIVE_CTX: TenantContext = {
  tenantId: "tnt_dev",
  slug: "dev",
  status: "active",
  features: new Map(),
};

function makeReq(): NextRequest {
  return new NextRequest("http://dev.localhost:3000/api/test", {
    headers: { host: "dev.localhost:3000" },
  });
}

beforeEach(() => {
  vi.mocked(resolveTenant).mockReset();
  vi.mocked(getToken).mockReset();
});

describe("withTenant", () => {
  it("invoca el handler con runWithTenant cuando tenant=active", async () => {
    vi.mocked(resolveTenant).mockResolvedValue({
      kind: "tenant",
      ctx: ACTIVE_CTX,
    } as ResolveResult);
    vi.mocked(getToken).mockResolvedValue(null);

    const handler = vi.fn(async () => {
      const ctx = currentTenant();
      return new Response(JSON.stringify({ slug: ctx.slug }), { status: 200 });
    });
    const wrapped = withTenant(handler);
    const res = await wrapped(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("dev");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("404 si resolveTenant devuelve kind=invalid", async () => {
    vi.mocked(resolveTenant).mockResolvedValue({
      kind: "invalid",
      reason: "x",
    } as ResolveResult);
    const handler = vi.fn();
    const wrapped = withTenant(handler);
    const res = await wrapped(makeReq());
    expect(res.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("404 si resolveTenant devuelve kind=apex|app|admin|not_found", async () => {
    for (const kind of ["apex", "app", "admin"] as const) {
      vi.mocked(resolveTenant).mockResolvedValue({ kind } as ResolveResult);
      const handler = vi.fn();
      const wrapped = withTenant(handler);
      const res = await wrapped(makeReq());
      expect(res.status).toBe(404);
    }
    vi.mocked(resolveTenant).mockResolvedValue({
      kind: "not_found",
      slug: "x",
    } as ResolveResult);
    const handler = vi.fn();
    const wrapped = withTenant(handler);
    const res = await wrapped(makeReq());
    expect(res.status).toBe(404);
  });

  it("503 + Retry-After:30 si status=pending", async () => {
    vi.mocked(resolveTenant).mockResolvedValue({
      kind: "tenant",
      ctx: { ...ACTIVE_CTX, status: "pending" },
    } as ResolveResult);
    const wrapped = withTenant(vi.fn());
    const res = await wrapped(makeReq());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("503 + Retry-After:30 si status=provisioning", async () => {
    vi.mocked(resolveTenant).mockResolvedValue({
      kind: "tenant",
      ctx: { ...ACTIVE_CTX, status: "provisioning" },
    } as ResolveResult);
    const wrapped = withTenant(vi.fn());
    const res = await wrapped(makeReq());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("402 si status=suspended", async () => {
    vi.mocked(resolveTenant).mockResolvedValue({
      kind: "tenant",
      ctx: { ...ACTIVE_CTX, status: "suspended" },
    } as ResolveResult);
    const wrapped = withTenant(vi.fn());
    const res = await wrapped(makeReq());
    expect(res.status).toBe(402);
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("410 si status=deleted", async () => {
    vi.mocked(resolveTenant).mockResolvedValue({
      kind: "tenant",
      ctx: { ...ACTIVE_CTX, status: "deleted" },
    } as ResolveResult);
    const wrapped = withTenant(vi.fn());
    const res = await wrapped(makeReq());
    expect(res.status).toBe(410);
  });

  it("401 si JWT.tenantSlug != ctx.slug", async () => {
    vi.mocked(resolveTenant).mockResolvedValue({
      kind: "tenant",
      ctx: ACTIVE_CTX,
    } as ResolveResult);
    vi.mocked(getToken).mockResolvedValue({
      tenantSlug: "otroTenant",
    } as never);
    const handler = vi.fn();
    const wrapped = withTenant(handler);
    const res = await wrapped(makeReq());
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("permite la request si JWT.tenantSlug coincide con ctx.slug", async () => {
    vi.mocked(resolveTenant).mockResolvedValue({
      kind: "tenant",
      ctx: ACTIVE_CTX,
    } as ResolveResult);
    vi.mocked(getToken).mockResolvedValue({
      tenantSlug: "dev",
    } as never);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const wrapped = withTenant(handler);
    const res = await wrapped(makeReq());
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("ignora errores de getToken (token ausente o malformado)", async () => {
    vi.mocked(resolveTenant).mockResolvedValue({
      kind: "tenant",
      ctx: ACTIVE_CTX,
    } as ResolveResult);
    vi.mocked(getToken).mockRejectedValue(new Error("malformed"));
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const wrapped = withTenant(handler);
    const res = await wrapped(makeReq());
    expect(res.status).toBe(200);
  });
});
