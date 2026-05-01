/**
 * Tests sendPush con gates feature + quota. TODO N17.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: mockSend },
}));

vi.mock("@/lib/prisma", () => ({
  prismaApp: {
    configuracionEmpresa: { findFirst: vi.fn() },
    pushSubscripcion: { findMany: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/tenant/features", () => ({
  hasFeature: vi.fn(),
  consumeQuota: vi.fn(),
}));

vi.mock("@/lib/tenant/context", () => ({
  maybeCurrentTenant: vi.fn(),
}));

import { sendPush } from "./push";
import { prismaApp } from "@/lib/prisma";
import { hasFeature, consumeQuota } from "@/lib/tenant/features";
import { maybeCurrentTenant } from "@/lib/tenant/context";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(maybeCurrentTenant).mockReturnValue({
    tenantId: "t1",
    slug: "t1",
    status: "active",
    features: new Map(),
  } as never);
  vi.mocked(prismaApp.configuracionEmpresa.findFirst).mockResolvedValue({
    pushActivo: true,
    pushVapidPublicKey: "pk",
    pushVapidPrivateKey: "sk",
    emailFrom: "x@x",
  } as never);
  vi.mocked(prismaApp.pushSubscripcion.findMany).mockResolvedValue([
    { id: "s1", endpoint: "https://x", p256dh: "p", auth: "a" },
  ] as never);
});

describe("sendPush", () => {
  it("sin tenant → no_tenant_context", async () => {
    vi.mocked(maybeCurrentTenant).mockReturnValueOnce(undefined);
    const r = await sendPush("u1", "t", "b");
    expect(r).toEqual({ ok: false, reason: "no_tenant_context" });
  });

  it("feature OFF → feature_not_contracted", async () => {
    vi.mocked(hasFeature).mockReturnValueOnce(false);
    const r = await sendPush("u1", "t", "b");
    expect(r).toEqual({ ok: false, reason: "feature_not_contracted" });
  });

  it("quota agotada → quota_exceeded", async () => {
    vi.mocked(hasFeature).mockReturnValueOnce(true);
    vi.mocked(consumeQuota).mockResolvedValueOnce({
      ok: false,
      reason: "limit_reached",
      used: 1000,
      max: 1000,
      resetAt: new Date(),
    });
    const r = await sendPush("u1", "t", "b");
    expect(r).toEqual({ ok: false, reason: "quota_exceeded" });
  });

  it("VAPID no config → vapid_not_configured", async () => {
    vi.mocked(hasFeature).mockReturnValueOnce(true);
    vi.mocked(consumeQuota).mockResolvedValueOnce({
      ok: true,
      remaining: null,
      resetAt: new Date(),
    });
    vi.mocked(prismaApp.configuracionEmpresa.findFirst).mockResolvedValueOnce({
      pushActivo: false,
    } as never);
    const r = await sendPush("u1", "t", "b");
    expect(r).toEqual({ ok: false, reason: "vapid_not_configured" });
  });

  it("feature ON + quota ON + VAPID OK → envía", async () => {
    vi.mocked(hasFeature).mockReturnValueOnce(true);
    vi.mocked(consumeQuota).mockResolvedValueOnce({
      ok: true,
      remaining: null,
      resetAt: new Date(),
    });
    mockSend.mockResolvedValueOnce(undefined);
    const r = await sendPush("u1", "t", "b");
    expect(r).toEqual({ ok: true, sent: 1 });
    expect(mockSend).toHaveBeenCalledOnce();
  });
});
