/**
 * Tests de resolveTenant con dependencies inyectadas (sin BD).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resolveTenant, type ResolveDeps } from "./resolver";
import { _resetCache } from "./cache";

function makeDeps(overrides: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    findTenantBySlug: async (_slug) => null,
    findTenantByCustomDomain: async (_host) => null,
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

  it("host fuera del root sin custom_domain registrado → kind=invalid", async () => {
    // Antes Fase 6 esto era invalid sin tocar BD. Ahora consulta la
    // tabla y solo devuelve invalid si findTenantByCustomDomain
    // retorna null (lo cual hace makeDeps por default).
    const r = await resolveTenant("evil.com", makeDeps());
    expect(r).toMatchObject({ kind: "invalid", reason: expect.any(String) });
  });

  it("custom_domain verificado + feature ON → kind=tenant", async () => {
    const r = await resolveTenant(
      "fichaje.empresa.com",
      makeDeps({
        findTenantByCustomDomain: async (host) => {
          if (host === "fichaje.empresa.com")
            return { id: "tnt_emp", slug: "empresa", status: "active" };
          return null;
        },
        loadFeaturesFor: async () =>
          new Map([
            [
              "dominio_personalizado",
              {
                key: "dominio_personalizado",
                value: true,
                source: "addon" as const,
                expiresAt: null,
              },
            ],
          ]),
      }),
    );
    expect(r).toMatchObject({
      kind: "tenant",
      ctx: { tenantId: "tnt_emp", slug: "empresa", status: "active" },
    });
  });

  it("custom_domain verificado pero feature OFF → kind=invalid", async () => {
    const r = await resolveTenant(
      "fichaje.empresa.com",
      makeDeps({
        findTenantByCustomDomain: async () => ({
          id: "tnt_emp",
          slug: "empresa",
          status: "active",
        }),
        // features VACÍO o sin dominio_personalizado=true → invalid.
        loadFeaturesFor: async () => new Map(),
      }),
    );
    expect(r).toMatchObject({
      kind: "invalid",
      reason: expect.stringContaining("feature"),
    });
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
