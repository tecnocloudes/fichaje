import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/tenant/features", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant/features")>(
    "@/lib/tenant/features",
  );
  return {
    ...actual,
    consumeQuota: vi.fn(),
  };
});

import { consumeQuota } from "@/lib/tenant/features";
import { withQuota } from "./with-quota";

function makeReq(): NextRequest {
  return new NextRequest("http://test.localhost:3000/api/x", {
    headers: { host: "test.localhost:3000" },
  });
}

beforeEach(() => {
  vi.mocked(consumeQuota).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("withQuota", () => {
  it("ok: invoca handler y no toca status", async () => {
    vi.mocked(consumeQuota).mockResolvedValue({
      ok: true,
      remaining: 99,
      resetAt: new Date(Date.now() + 30 * 86400 * 1000),
    });
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const wrapped = withQuota("exports_mes", 1, handler);
    const res = await wrapped(makeReq());
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(vi.mocked(consumeQuota)).toHaveBeenCalledWith("exports_mes", 1);
  });

  it("period_unavailable → 429 + Retry-After: 30", async () => {
    vi.mocked(consumeQuota).mockResolvedValue({
      ok: false,
      reason: "period_unavailable",
    });
    const handler = vi.fn();
    const wrapped = withQuota("exports_mes", 1, handler);
    const res = await wrapped(makeReq());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = await res.json();
    expect(body.error).toBe("quota_period_unavailable");
    expect(body.feature_key).toBe("exports_mes");
    expect(handler).not.toHaveBeenCalled();
  });

  it("limit_reached → 429 + Retry-After hasta resetAt + body con used/max/reset_at", async () => {
    const resetAt = new Date(Date.now() + 60 * 1000); // 60s desde ahora
    vi.mocked(consumeQuota).mockResolvedValue({
      ok: false,
      reason: "limit_reached",
      used: 100,
      max: 100,
      resetAt,
    });
    const handler = vi.fn();
    const wrapped = withQuota("exports_mes", 1, handler);
    const res = await wrapped(makeReq());
    expect(res.status).toBe(429);
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "0", 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = await res.json();
    expect(body).toEqual({
      error: "quota_exceeded",
      feature_key: "exports_mes",
      used: 100,
      max: 100,
      reset_at: resetAt.toISOString(),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("Retry-After siempre >= 1 (resetAt en el pasado)", async () => {
    const resetAtPast = new Date(Date.now() - 5000);
    vi.mocked(consumeQuota).mockResolvedValue({
      ok: false,
      reason: "limit_reached",
      used: 100,
      max: 100,
      resetAt: resetAtPast,
    });
    const wrapped = withQuota("exports_mes", 1, vi.fn());
    const res = await wrapped(makeReq());
    expect(res.headers.get("Retry-After")).toBe("1");
  });
});
