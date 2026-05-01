/**
 * Tests del helper sendEmail con gates feature + quota.
 * TODO N17 cerrado.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();
vi.mock("resend", () => {
  class MockResend {
    emails = { send: mockSend };
  }
  return { Resend: MockResend };
});

vi.mock("@/lib/prisma", () => ({
  prismaApp: {
    configuracionEmpresa: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/tenant/features", () => ({
  hasFeature: vi.fn(),
  consumeQuota: vi.fn(),
}));

vi.mock("@/lib/tenant/context", () => ({
  maybeCurrentTenant: vi.fn(),
}));

import { sendEmail, sendSystemEmail } from "./email";
import { prismaApp } from "@/lib/prisma";
import { hasFeature, consumeQuota } from "@/lib/tenant/features";
import { maybeCurrentTenant } from "@/lib/tenant/context";

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue({ data: { id: "ok" }, error: null });
  vi.mocked(maybeCurrentTenant).mockReturnValue({
    tenantId: "t1",
    slug: "t1",
    status: "active",
    features: new Map(),
  } as never);
  vi.mocked(prismaApp.configuracionEmpresa.findFirst).mockResolvedValue({
    emailActivo: true,
    emailPassword: "re_mock_key",
    emailFrom: "noreply@x.com",
  } as never);
});

describe("sendEmail (con gates)", () => {
  it("sin tenant en contexto → no_tenant_context", async () => {
    vi.mocked(maybeCurrentTenant).mockReturnValueOnce(undefined);
    const r = await sendEmail("a@b.com", "S", "<p>x</p>");
    expect(r).toEqual({ ok: false, reason: "no_tenant_context" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("feature notificaciones_email OFF → feature_not_contracted", async () => {
    vi.mocked(hasFeature).mockReturnValueOnce(false);
    const r = await sendEmail("a@b.com", "S", "<p>x</p>");
    expect(r).toEqual({ ok: false, reason: "feature_not_contracted" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("quota emails_mes agotada → quota_exceeded", async () => {
    vi.mocked(hasFeature).mockReturnValueOnce(true);
    vi.mocked(consumeQuota).mockResolvedValueOnce({
      ok: false,
      reason: "limit_reached",
      used: 200,
      max: 200,
      resetAt: new Date(),
    });
    const r = await sendEmail("a@b.com", "S", "<p>x</p>");
    expect(r).toEqual({ ok: false, reason: "quota_exceeded" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("SMTP no configurado → smtp_not_configured", async () => {
    vi.mocked(hasFeature).mockReturnValueOnce(true);
    vi.mocked(consumeQuota).mockResolvedValueOnce({
      ok: true,
      remaining: 199,
      resetAt: new Date(),
    });
    vi.mocked(prismaApp.configuracionEmpresa.findFirst).mockResolvedValueOnce({
      emailActivo: false,
      emailPassword: null,
      emailFrom: null,
    } as never);
    const r = await sendEmail("a@b.com", "S", "<p>x</p>");
    expect(r).toEqual({ ok: false, reason: "smtp_not_configured" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("feature ON + quota ON + SMTP OK → envía", async () => {
    vi.mocked(hasFeature).mockReturnValueOnce(true);
    vi.mocked(consumeQuota).mockResolvedValueOnce({
      ok: true,
      remaining: 199,
      resetAt: new Date(),
    });
    const r = await sendEmail("a@b.com", "S", "<p>x</p>");
    expect(r).toEqual({ ok: true });
    expect(mockSend).toHaveBeenCalledOnce();
    const arg = mockSend.mock.calls[0]![0];
    expect(arg.to).toBe("a@b.com");
    expect(arg.from).toBe("noreply@x.com");
  });
});

describe("sendSystemEmail (sin gates)", () => {
  it("envía sin chequear feature ni consumir quota", async () => {
    process.env.RESEND_API_KEY = "re_system";
    await sendSystemEmail("ops@x.com", "Stripe checkout", "<p>x</p>", {
      from: "system@x.com",
    });
    expect(hasFeature).not.toHaveBeenCalled();
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("sin RESEND_API_KEY → fallback console.log (no lanza)", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(
      sendSystemEmail("a@b", "x", "<p/>"),
    ).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
