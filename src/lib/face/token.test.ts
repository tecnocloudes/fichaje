import { describe, it, expect } from "vitest";
import { issueFaceToken, consumeFaceToken } from "@/lib/face/token";

const KEY = "0".repeat(64);

describe("face/token", () => {
  it("issues and consumes a token once", () => {
    process.env.IA_ENCRYPTION_KEY = KEY;
    const t = issueFaceToken("user-1", "tenant-a");
    expect(consumeFaceToken(t, "user-1", "tenant-a")).toEqual({ ok: true });
    expect(consumeFaceToken(t, "user-1", "tenant-a").ok).toBe(false);
  });

  it("rejects wrong tenant", () => {
    process.env.IA_ENCRYPTION_KEY = KEY;
    const t = issueFaceToken("user-1", "tenant-a");
    const r = consumeFaceToken(t, "user-1", "tenant-b");
    expect(r).toEqual({ ok: false, reason: "wrong_tenant" });
  });

  it("rejects wrong user", () => {
    process.env.IA_ENCRYPTION_KEY = KEY;
    const t = issueFaceToken("user-1", "tenant-a");
    const r = consumeFaceToken(t, "user-2", "tenant-a");
    expect(r).toEqual({ ok: false, reason: "wrong_user" });
  });

  it("rejects tampered signature", () => {
    process.env.IA_ENCRYPTION_KEY = KEY;
    const t = issueFaceToken("user-1", "tenant-a");
    const tampered = t.replace(/.$/, (c) => (c === "a" ? "b" : "a"));
    const r = consumeFaceToken(tampered, "user-1", "tenant-a");
    expect(r.ok).toBe(false);
  });
});
