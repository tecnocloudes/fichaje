import { describe, it, expect } from "vitest";
import {
  quoteSchemaName,
  isValidTenantSlug,
  InvalidTenantSlugError,
} from "./quote";

describe("quoteSchemaName", () => {
  it("acepta slug válido y devuelve identificador entrecomillado", () => {
    expect(quoteSchemaName("acme")).toBe('"tenant_acme"');
    expect(quoteSchemaName("acme_v2")).toBe('"tenant_acme_v2"');
    expect(quoteSchemaName("a12")).toBe('"tenant_a12"');
  });

  it("acepta longitud mínima 3 y máxima 31", () => {
    expect(quoteSchemaName("abc")).toBe('"tenant_abc"');
    const max = "a" + "b".repeat(30); // 31 chars
    expect(quoteSchemaName(max)).toBe(`"tenant_${max}"`);
  });

  it("rechaza slug con mayúsculas", () => {
    expect(() => quoteSchemaName("Acme")).toThrow(InvalidTenantSlugError);
    expect(() => quoteSchemaName("ACME")).toThrow();
    expect(() => quoteSchemaName("acmeX")).toThrow();
  });

  it("rechaza slug que empieza por dígito o guion bajo", () => {
    expect(() => quoteSchemaName("1acme")).toThrow();
    expect(() => quoteSchemaName("_acme")).toThrow();
  });

  it("rechaza slug demasiado corto (<3 chars)", () => {
    expect(() => quoteSchemaName("ab")).toThrow();
    expect(() => quoteSchemaName("")).toThrow();
  });

  it("rechaza slug demasiado largo (>31 chars)", () => {
    const tooLong = "a" + "b".repeat(31); // 32 chars
    expect(() => quoteSchemaName(tooLong)).toThrow();
  });

  it("rechaza intentos de SQL injection", () => {
    expect(() => quoteSchemaName("acme; DROP SCHEMA public CASCADE; --")).toThrow();
    expect(() => quoteSchemaName('acme"; DROP TABLE users;--')).toThrow();
    expect(() => quoteSchemaName("acme' OR '1'='1")).toThrow();
    expect(() => quoteSchemaName("acme--")).toThrow();
    expect(() => quoteSchemaName("acme/*comment*/")).toThrow();
    expect(() => quoteSchemaName("acme\nDROP")).toThrow();
    expect(() => quoteSchemaName("acme\\")).toThrow();
  });

  it("rechaza espacios y caracteres unicode", () => {
    expect(() => quoteSchemaName("acme acme")).toThrow();
    expect(() => quoteSchemaName(" acme")).toThrow();
    expect(() => quoteSchemaName("acmé")).toThrow();
    expect(() => quoteSchemaName("açme")).toThrow();
  });

  it("rechaza tipo no-string", () => {
    expect(() => quoteSchemaName(undefined as unknown as string)).toThrow();
    expect(() => quoteSchemaName(null as unknown as string)).toThrow();
    expect(() => quoteSchemaName(123 as unknown as string)).toThrow();
    expect(() => quoteSchemaName({} as unknown as string)).toThrow();
  });

  it("InvalidTenantSlugError tiene name correcto", () => {
    try {
      quoteSchemaName("BAD");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTenantSlugError);
      expect((e as Error).name).toBe("InvalidTenantSlugError");
    }
  });
});

describe("isValidTenantSlug", () => {
  it("devuelve true para válidos", () => {
    expect(isValidTenantSlug("acme")).toBe(true);
    expect(isValidTenantSlug("ab1")).toBe(true);
    expect(isValidTenantSlug("a_b_c_2026")).toBe(true);
  });

  it("devuelve false sin throw para inválidos", () => {
    expect(isValidTenantSlug("Bad")).toBe(false);
    expect(isValidTenantSlug("ab")).toBe(false);
    expect(isValidTenantSlug("a;DROP")).toBe(false);
    expect(isValidTenantSlug(undefined)).toBe(false);
    expect(isValidTenantSlug(null)).toBe(false);
    expect(isValidTenantSlug(123)).toBe(false);
  });
});
