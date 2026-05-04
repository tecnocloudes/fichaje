"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Loader2, ExternalLink, Globe } from "lucide-react";

interface Tenant {
  id: string;
  slug: string;
  name: string;
  email: string;
  status: "pending" | "provisioning" | "active" | "suspended" | "deleted";
  customDomain?: string | null;
  customDomainVerified?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApiResponse {
  items: Tenant[];
  total: number;
}

const STATUS_FILTERS = [
  { value: "", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "trialing", label: "Trial" },
  { value: "pending", label: "Pendientes" },
  { value: "provisioning", label: "Aprovisionando" },
  { value: "suspended", label: "Suspendidos" },
  { value: "deleted", label: "Eliminados" },
] as const;

const STATUS_TONE: Record<Tenant["status"], string> = {
  active: "bg-emerald-50 text-emerald-800",
  pending: "bg-amber-50 text-amber-800",
  provisioning: "bg-sky-50 text-sky-800",
  suspended: "bg-orange-50 text-orange-800",
  deleted: "bg-slate-100 text-slate-600",
};

const STATUS_LABEL: Record<Tenant["status"], string> = {
  active: "Activo",
  pending: "Pendiente",
  provisioning: "Aprovisionando",
  suspended: "Suspendido",
  deleted: "Eliminado",
};

export default function TenantsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (status) p.set("status", status);
    p.set("limit", "100");
    return p.toString();
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(() => {
      let stopped = false;
      (async () => {
        setLoading(true);
        setError(null);
        try {
          const r = await fetch(`/api/admin/tenants?${queryString}`);
          if (r.status === 401) {
            window.location.href = "/admin/login";
            return;
          }
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          if (!stopped) setData((await r.json()) as ApiResponse);
        } catch (e) {
          if (!stopped) setError(e instanceof Error ? e.message : "Error de red");
        } finally {
          if (!stopped) setLoading(false);
        }
      })();
      return () => {
        stopped = true;
      };
    }, 200);
    return () => clearTimeout(t);
  }, [queryString]);

  const rootDomain = typeof window !== "undefined"
    ? window.location.host.replace(/^admin\./, "")
    : "empleaia.es";

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Tenants
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            {data ? `${data.total} cuenta${data.total === 1 ? "" : "s"} en total` : "Cargando…"}
          </p>
        </div>
      </header>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted,#94A3B8)]" />
          <input
            type="search"
            placeholder="Buscar por slug, nombre o email…"
            className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white pl-9 pr-3 py-2 text-sm placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                status === f.value
                  ? "bg-white text-[var(--color-text-dark,#0F172A)] shadow-sm"
                  : "text-[var(--color-text-body,#475569)] hover:text-[var(--color-text-dark,#0F172A)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-[var(--color-border,#E2E8F0)] rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--color-text-body,#475569)]">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Cargando tenants…
          </div>
        ) : error ? (
          <div className="px-4 py-3 text-sm text-red-800 bg-red-50 border-b border-red-200">{error}</div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-16 text-center text-[var(--color-text-muted,#94A3B8)]">
            <Globe className="h-10 w-10 mx-auto mb-2 text-slate-200" />
            <p className="text-sm">No hay tenants que coincidan</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--bg-subtle,#F8FAFC)] border-b border-[var(--color-border,#E2E8F0)]">
                <tr>
                  {["Slug", "Empresa", "Email", "Estado", "Dominio", "Creado", "Acciones"].map((h) => (
                    <th
                      key={h}
                      className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-body,#475569)] px-4 py-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((t) => (
                  <tr key={t.id} className="hover:bg-[var(--bg-subtle,#F8FAFC)] transition-colors">
                    <td className="px-4 py-3">
                      <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-[var(--color-text-dark,#0F172A)] font-mono">
                        {t.slug}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-[var(--color-text-dark,#0F172A)]">
                      {t.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)] max-w-[220px] truncate">
                      {t.email}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[t.status]}`}>
                        {STATUS_LABEL[t.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {t.customDomain ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[var(--color-text-body,#475569)]">{t.customDomain}</span>
                          {t.customDomainVerified ? (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" title="Verificado" />
                          ) : (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" title="Pendiente verificación" />
                          )}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-muted,#94A3B8)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)] tabular-nums">
                      {new Date(t.createdAt).toLocaleDateString("es-ES")}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`https://${t.slug}.${rootDomain}/admin`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Abrir
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
