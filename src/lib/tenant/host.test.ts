import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseHost } from "./host";

describe("parseHost", () => {
  const ORIG = process.env.TENANT_ROOT_DOMAIN;

  beforeEach(() => {
    process.env.TENANT_ROOT_DOMAIN = "ficha.tecnocloud.es";
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.TENANT_ROOT_DOMAIN;
    else process.env.TENANT_ROOT_DOMAIN = ORIG;
  });

  it("apex devuelve kind=apex", () => {
    expect(parseHost("ficha.tecnocloud.es")).toEqual({ kind: "apex" });
  });

  it("subdominio app reservado", () => {
    expect(parseHost("app.ficha.tecnocloud.es")).toEqual({ kind: "app" });
    expect(parseHost("www.ficha.tecnocloud.es")).toEqual({ kind: "app" });
  });

  it("subdominio admin reservado", () => {
    expect(parseHost("admin.ficha.tecnocloud.es")).toEqual({ kind: "admin" });
  });

  it("subdominio tenant válido", () => {
    expect(parseHost("acme.ficha.tecnocloud.es")).toEqual({
      kind: "tenant",
      slug: "acme",
    });
  });

  it("ignora puerto", () => {
    expect(parseHost("acme.ficha.tecnocloud.es:443")).toEqual({
      kind: "tenant",
      slug: "acme",
    });
  });

  it("baja a minúsculas", () => {
    expect(parseHost("ACME.Ficha.Tecnocloud.Es")).toEqual({
      kind: "tenant",
      slug: "acme",
    });
  });

  it("slug que no cumple regex es invalid", () => {
    expect(parseHost("ab.ficha.tecnocloud.es")).toMatchObject({ kind: "invalid" });
    expect(parseHost("1acme.ficha.tecnocloud.es")).toMatchObject({ kind: "invalid" });
    expect(parseHost("ACME-Bad.ficha.tecnocloud.es")).toMatchObject({ kind: "invalid" });
  });

  it("sub-subdominio es invalid", () => {
    expect(parseHost("foo.acme.ficha.tecnocloud.es")).toMatchObject({
      kind: "invalid",
      reason: expect.stringContaining("sub-subdominio"),
    });
  });

  it("host fuera del dominio root es invalid", () => {
    expect(parseHost("acme.example.com")).toMatchObject({ kind: "invalid" });
    expect(parseHost("evil.com")).toMatchObject({ kind: "invalid" });
  });

  it("localhost es apex", () => {
    expect(parseHost("localhost")).toEqual({ kind: "apex" });
    expect(parseHost("localhost:3000")).toEqual({ kind: "apex" });
  });

  it("<slug>.localhost se trata como tenant en desarrollo", () => {
    expect(parseHost("dev.localhost")).toEqual({ kind: "tenant", slug: "dev" });
    expect(parseHost("dev.localhost:3000")).toEqual({ kind: "tenant", slug: "dev" });
    expect(parseHost("acme.localhost")).toEqual({ kind: "tenant", slug: "acme" });
  });

  it("app.localhost y admin.localhost siguen siendo reservados", () => {
    expect(parseHost("app.localhost")).toEqual({ kind: "app" });
    expect(parseHost("admin.localhost")).toEqual({ kind: "admin" });
  });

  it("host vacío o null es invalid", () => {
    expect(parseHost("")).toMatchObject({ kind: "invalid" });
    expect(parseHost(null)).toMatchObject({ kind: "invalid" });
    expect(parseHost(undefined)).toMatchObject({ kind: "invalid" });
  });

  it("respeta TENANT_ROOT_DOMAIN custom", () => {
    process.env.TENANT_ROOT_DOMAIN = "fichaje.example";
    expect(parseHost("acme.fichaje.example")).toEqual({
      kind: "tenant",
      slug: "acme",
    });
    expect(parseHost("acme.ficha.tecnocloud.es")).toMatchObject({ kind: "invalid" });
  });
});
