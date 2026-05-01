"use client";

import { useEffect, useState } from "react";

type Metrics = {
  tenants: { byStatus: Record<string, number>; total: number; registros30d: number };
  subscriptions: { byStatus: Record<string, number>; activeCount: number };
  audit24h: { bySeverity: Record<string, number> };
};

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch("/api/admin/metrics");
        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (r.ok) setMetrics(await r.json());
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) return <p className="text-slate-500">Cargando métricas...</p>;
  if (!metrics) return <p className="text-red-600">Error al cargar métricas.</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Métricas globales</h1>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Tenants total" value={metrics.tenants.total} />
        <Card title="Activos" value={metrics.tenants.byStatus.active ?? 0} />
        <Card title="Registros 30d" value={metrics.tenants.registros30d} />
      </div>

      <div>
        <h2 className="font-semibold text-slate-700 mb-2">Por status</h2>
        <pre className="bg-white border rounded p-3 text-xs">
          {JSON.stringify(metrics.tenants.byStatus, null, 2)}
        </pre>
      </div>

      <div>
        <h2 className="font-semibold text-slate-700 mb-2">Subscriptions</h2>
        <pre className="bg-white border rounded p-3 text-xs">
          {JSON.stringify(metrics.subscriptions, null, 2)}
        </pre>
      </div>

      <div>
        <h2 className="font-semibold text-slate-700 mb-2">Audit 24h</h2>
        <pre className="bg-white border rounded p-3 text-xs">
          {JSON.stringify(metrics.audit24h, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function Card({ title, value }: { title: string; value: number }) {
  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
