import { describe, it, expect } from "vitest";
import { AUDIT_ACTIONS, severityOf } from "./audit-actions";

describe("AUDIT_ACTIONS", () => {
  it("incluye al menos las acciones esenciales del panel", () => {
    const required = [
      "tenants:list",
      "tenants:read",
      "tenant_features:override",
      "tenants:suspend",
      "tenants:restore",
      "tenants:purge:pseudonymize",
      "tenants:purge:hard-delete",
      "super-admin:login",
      "audit-log:list",
    ];
    for (const k of required) {
      expect(AUDIT_ACTIONS).toHaveProperty(k);
    }
  });

  it("severity solo permitida: info | warning | critical", () => {
    for (const def of Object.values(AUDIT_ACTIONS)) {
      expect(["info", "warning", "critical"]).toContain(def.severity);
    }
  });

  it("acciones de purge son critical", () => {
    expect(severityOf("tenants:purge:pseudonymize")).toBe("critical");
    expect(severityOf("tenants:purge:hard-delete")).toBe("critical");
  });

  it("lecturas son info", () => {
    expect(severityOf("tenants:list")).toBe("info");
    expect(severityOf("audit-log:list")).toBe("info");
    expect(severityOf("metrics:read")).toBe("info");
  });

  it("override y lifecycle son warning", () => {
    expect(severityOf("tenant_features:override")).toBe("warning");
    expect(severityOf("tenants:suspend")).toBe("warning");
    expect(severityOf("tenants:restore")).toBe("warning");
  });
});
