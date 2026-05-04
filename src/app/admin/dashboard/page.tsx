"use client";

import { useEffect, useState } from "react";
import { Building2, CheckCircle2, TrendingUp, AlertTriangle, CreditCard, Activity, Loader2 } from "lucide-react";

type Metrics = {
  tenants: { byStatus: Record<string, number>; total: number; registros30d: number };
  subscriptions: { byStatus: Record<string, number>; activeCount: number; mrrEur?: number | null };
  audit24h: { bySeverity: Record<string, number> };
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendientes",
  provisioning: "Aprovisionando",
  active: "Activos",
  suspended: "Suspendidos",
  deleted: "Eliminados",
};

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800",
  provisioning: "bg-sky-50 text-sky-800",
  active: "bg-emerald-50 text-emerald-800",
  suspended: "bg-orange-50 text-orange-800",
  deleted: "bg-slate-100 text-slate-600",
};

const SUB_STATUS_LABEL: Record<string, string> = {
  trialing: "En trial",
  active: "Activas",
  past_due: "Impago",
  unpaid: "No pagadas",
  canceled: "Canceladas",
  incomplete: "Incompletas",
  incomplete_expired: "Expiradas",
  paused: "Pausadas",
};

const SEVERITY_TONE: Record<string, string> = {
  info: "bg-sky-50 text-sky-800",
  warning: "bg-amber-50 text-amber-800",
  error: "bg-red-50 text-red-800",
  critical: "bg-red-50 text-red-800",
};

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch("/api/admin/metrics");
        if (r.status === 401) {
          window.location.href = "/admin/login";
          return;
        }
        if (r.ok) {
          setMetrics((await r.json()) as Metrics);
        } else {
          setError(`Error ${r.status}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-[var(--color-text-body,#475569)]">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Cargando métricas…
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error ?? "Error al cargar métricas."}
      </div>
    );
  }

  const tenantsByStatus = Object.entries(metrics.tenants.byStatus).sort(
    (a, b) => b[1] - a[1],
  );
  const subsByStatus = Object.entries(metrics.subscriptions.byStatus).sort(
    (a, b) => b[1] - a[1],
  );
  const auditBySeverity = Object.entries(metrics.audit24h.bySeverity).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
          Métricas globales
        </h1>
        <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
          Resumen del estado de la plataforma empleaIA.
        </p>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Tenants total"
          value={metrics.tenants.total}
          icon={Building2}
          tone="primary"
        />
        <KpiCard
          label="Tenants activos"
          value={metrics.tenants.byStatus.active ?? 0}
          icon={CheckCircle2}
          tone="success"
        />
        <KpiCard
          label="Registros 30d"
          value={metrics.tenants.registros30d}
          icon={TrendingUp}
          tone="info"
        />
        <KpiCard
          label="Suscripciones activas"
          value={metrics.subscriptions.activeCount}
          icon={CreditCard}
          tone="primary"
          hint={
            metrics.subscriptions.mrrEur != null
              ? `MRR ${metrics.subscriptions.mrrEur.toFixed(2)} €`
              : undefined
          }
        />
      </section>

      {/* Distribuciones */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel
          title="Tenants por estado"
          icon={Building2}
          empty={tenantsByStatus.length === 0}
          emptyText="Aún no hay tenants"
        >
          {tenantsByStatus.map(([status, count]) => (
            <RowItem
              key={status}
              label={STATUS_LABEL[status] ?? status}
              tone={STATUS_TONE[status] ?? "bg-slate-100 text-slate-600"}
              value={count}
            />
          ))}
        </Panel>

        <Panel
          title="Suscripciones por estado"
          icon={CreditCard}
          empty={subsByStatus.length === 0}
          emptyText="No hay suscripciones todavía"
        >
          {subsByStatus.map(([status, count]) => (
            <RowItem
              key={status}
              label={SUB_STATUS_LABEL[status] ?? status}
              tone="bg-[var(--primary-light)] text-[var(--primary)]"
              value={count}
            />
          ))}
        </Panel>
      </section>

      {/* Audit 24h */}
      <section>
        <Panel
          title="Auditoría últimas 24h"
          icon={Activity}
          empty={auditBySeverity.length === 0}
          emptyText="Sin eventos en las últimas 24h"
        >
          {auditBySeverity.map(([severity, count]) => (
            <RowItem
              key={severity}
              label={severity}
              tone={SEVERITY_TONE[severity] ?? "bg-slate-100 text-slate-600"}
              value={count}
              icon={
                severity === "warning" || severity === "error" || severity === "critical"
                  ? AlertTriangle
                  : undefined
              }
            />
          ))}
        </Panel>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: number;
  icon: typeof Building2;
  tone: "primary" | "success" | "info" | "warning";
  hint?: string;
}) {
  const colors: Record<string, { bg: string; fg: string }> = {
    primary: { bg: "bg-[var(--primary-light)]", fg: "text-[var(--primary)]" },
    success: { bg: "bg-emerald-50", fg: "text-emerald-600" },
    info: { bg: "bg-sky-50", fg: "text-sky-600" },
    warning: { bg: "bg-amber-50", fg: "text-amber-600" },
  };
  const c = colors[tone];
  return (
    <div className="bg-white border border-[var(--color-border,#E2E8F0)] rounded-lg p-5">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ${c.bg}`}>
          <Icon className={`h-5 w-5 ${c.fg}`} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-[var(--color-text-body,#475569)] uppercase tracking-wide">
            {label}
          </p>
          <p className="text-3xl font-bold mt-1 text-[var(--color-text-dark,#0F172A)]">{value}</p>
          {hint && <p className="text-xs text-[var(--color-text-muted,#94A3B8)] mt-1">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
  empty,
  emptyText,
}: {
  title: string;
  icon: typeof Building2;
  children: React.ReactNode;
  empty?: boolean;
  emptyText?: string;
}) {
  return (
    <div className="bg-white border border-[var(--color-border,#E2E8F0)] rounded-lg">
      <div className="px-5 py-3 border-b border-[var(--color-border,#E2E8F0)] flex items-center gap-2">
        <Icon className="h-4 w-4 text-[var(--primary)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text-dark,#0F172A)]">{title}</h2>
      </div>
      <div className="p-5">
        {empty ? (
          <p className="text-sm text-[var(--color-text-muted,#94A3B8)] text-center py-6">
            {emptyText}
          </p>
        ) : (
          <div className="space-y-2">{children}</div>
        )}
      </div>
    </div>
  );
}

function RowItem({
  label,
  tone,
  value,
  icon: Icon,
}: {
  label: string;
  tone: string;
  value: number;
  icon?: typeof Building2;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums text-[var(--color-text-dark,#0F172A)]">
        {value}
      </span>
    </div>
  );
}
