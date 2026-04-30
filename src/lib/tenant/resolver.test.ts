/**
 * Tests de resolveTenant con dependencies inyectadas (sin BD).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resolveTenant, type ResolveDeps } from "./resolver";
import { _resetCache } from "./cache";

function makeDeps(overrides: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    findTenantBySlug: async (_slug) => null,
    loadFeaturesFor: async () => new Map(),
    ...overrides,
  };
}

describe("resolveTenant", () => {
  beforeEach(() => {
    _resetCache();
    process.env.TENANT_ROOT_DOMAIN = "ficha.tecnocloud.es";
  });

  it("apex → kind=apex", async () => {
    const r = await resolveTenant("ficha.tecnocloud.es", makeDeps());
    expect(r.kind).toBe("apex");
  });

  it("app subdomain → kind=app", async () => {
    const r = await resolveTenant("app.ficha.tecnocloud.es", makeDeps());
    expect(r.kind).toBe("app");
  });

  it("admin subdomain → kind=admin", async () => {
    const r = await resolveTenant("admin.ficha.tecnocloud.es", makeDeps());
    expect(r.kind).toBe("admin");
  });

  it("host inválido → kind=invalid con reason", async () => {
    const r = await resolveTenant("evil.com", makeDeps());
    expect(r).toMatchObject({ kind: "invalid", reason: expect.any(String) });
  });

  it("tenant existente → kind=tenant con ctx", async () => {
    let calls = 0;
    const r = await resolveTenant(
      "acme.ficha.tecnocloud.es",
      makeDeps({
        findTenantBySlug: async (slug) => {
          calls++;
          if (slug === "acme")
            return { id: "tnt_acme", slug: "acme", status: "active" };
          return null;
        },
      }),
    );
    expect(calls).toBe(1);
    expect(r).toMatchObject({
      kind: "tenant",
      ctx: { tenantId: "tnt_acme", slug: "acme", status: "active" },
    });
  });

  it("tenant inexistente → kind=not_found", async () => {
    const r = await resolveTenant(
      "ghost.ficha.tecnocloud.es",
      makeDeps({ findTenantBySlug: async () => null }),
    );
    expect(r).toEqual({ kind: "not_found", slug: "ghost" });
  });

  it("cache positivo evita segunda lookup en BD", async () => {
    let calls = 0;
    const deps = makeDeps({
      findTenantBySlug: async () => {
        calls++;
        return { id: "tnt_acme", slug: "acme", status: "active" };
      },
    });
    await resolveTenant("acme.ficha.tecnocloud.es", deps);
    await resolveTenant("acme.ficha.tecnocloud.es", deps);
    expect(calls).toBe(1);
  });

  it("cache negativo evita segunda lookup en BD", async () => {
    let calls = 0;
    const deps = makeDeps({
      findTenantBySlug: async () => {
        calls++;
        return null;
      },
    });
    await resolveTenant("ghost.ficha.tecnocloud.es", deps);
    await resolveTenant("ghost.ficha.tecnocloud.es", deps);
    expect(calls).toBe(1);
  });

  it("propaga el status sin transformarlo", async () => {
    const r = await resolveTenant(
      "sus.ficha.tecnocloud.es",
      makeDeps({
        findTenantBySlug: async () => ({
          id: "tnt_sus",
          slug: "sus",
          status: "suspended",
        }),
      }),
    );
    expect(r).toMatchObject({ kind: "tenant", ctx: { status: "suspended" } });
  });

  it("status provisioning se propaga", async () => {
    const r = await resolveTenant(
      "new.ficha.tecnocloud.es",
      makeDeps({
        findTenantBySlug: async () => ({
          id: "tnt_new",
          slug: "new",
          status: "provisioning",
        }),
      }),
    );
    expect(r).toMatchObject({ kind: "tenant", ctx: { status: "provisioning" } });
  });
});
