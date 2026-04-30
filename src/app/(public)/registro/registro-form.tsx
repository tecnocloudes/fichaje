"use client";

import { useActionState } from "react";
import { registrarTenantAction, type RegistroResult } from "./actions";

type Plan = { key: string; name: string; description: string | null };

export function RegistroForm({ planes }: { planes: Plan[] }) {
  const [state, formAction, pending] = useActionState<
    RegistroResult | null,
    FormData
  >(async (_prev, fd) => registrarTenantAction(_prev, fd), null);

  return (
    <form action={formAction} style={{ display: "grid", gap: 16 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span>Nombre de la empresa</span>
        <input
          name="nombre"
          required
          minLength={2}
          maxLength={80}
          style={inputStyle}
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Email del administrador</span>
        <input name="email" type="email" required style={inputStyle} />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Subdominio (3-31 chars, minúsculas, dígitos, _)</span>
        <div style={{ display: "flex", alignItems: "center" }}>
          <input
            name="slug"
            required
            pattern="^[a-z][a-z0-9_]{2,30}$"
            placeholder="acme"
            style={{ ...inputStyle, flex: 1 }}
          />
          <span style={{ marginLeft: 8, color: "#6b7280" }}>.ficha.tecnocloud.es</span>
        </div>
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Plan</span>
        <select name="planKey" required style={inputStyle}>
          {planes.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
              {p.description ? ` — ${p.description}` : ""}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Periodo de facturación</span>
        <select name="billingPeriod" required style={inputStyle}>
          <option value="monthly">Mensual</option>
          <option value="yearly">Anual (2 meses gratis)</option>
        </select>
      </label>

      {state?.kind === "error" && (
        <div
          style={{
            background: "#fef2f2",
            color: "#991b1b",
            padding: 12,
            borderRadius: 6,
          }}
        >
          {state.message}
          {state.suggestions && state.suggestions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              Prueba con: {state.suggestions.join(", ")}
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        style={{
          background: "#6366f1",
          color: "white",
          padding: "12px 24px",
          borderRadius: 6,
          border: "none",
          fontSize: 16,
          cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "Procesando…" : "Continuar al pago"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 16,
};
