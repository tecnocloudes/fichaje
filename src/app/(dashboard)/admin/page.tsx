"use client";

import { useEffect, useState, useCallback } from "react";
import { Building2, Users, UserCheck, UserX, RefreshCw, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface TiendaStats {
  id: string;
  nombre: string;
  color: string;
  totalEmpleados: number;
  trabajando: number;
  enPausa: number;
  sinFichar: number;
  ausentes: number;
  presenciaPct: number;
}

interface GlobalStats {
  totalTiendas: number;
  totalEmpleados: number;
  fichadosAhora: number;
  ausentesHoy: number;
}

export default function AdminDashboardPage() {
  const [tiendas, setTiendas] = useState<TiendaStats[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/informes?tipo=presencia-global");
      const data = await res.json();
      setTiendas(data.tiendas || []);
      setStats(data.stats || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const chartData = tiendas.map((t) => ({
    nombre: t.nombre.split(" ").slice(-1)[0],
    trabajando: t.trabajando,
    enPausa: t.enPausa,
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Panel Global</h1>
          <p className="text-gray-500 text-sm mt-1">Vista en tiempo real de las 15 tiendas</p>
        </div>
        <Button variant="outline" size="icon" onClick={fetchData}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Stats globales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Tiendas activas", value: stats?.totalTiendas ?? "—", icon: Building2, color: "text-indigo-600", bg: "bg-indigo-50" },
          { label: "Total empleados", value: stats?.totalEmpleados ?? "—", icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Fichados ahora", value: stats?.fichadosAhora ?? "—", icon: UserCheck, color: "text-green-600", bg: "bg-green-50" },
          { label: "Ausentes hoy", value: stats?.ausentesHoy ?? "—", icon: UserX, color: "text-red-500", bg: "bg-red-50" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", s.bg)}>
                  <s.icon className={cn("h-5 w-5", s.color)} />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Gráfico presencia por tienda */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
              Presencia actual por tienda
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="trabajando" name="Trabajando" fill="#6366f1" radius={[4, 4, 0, 0]} stackId="a" />
                <Bar dataKey="enPausa" name="En pausa" fill="#fbbf24" radius={[4, 4, 0, 0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Grid de tiendas */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Estado por tienda</h2>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tiendas.map((t) => (
              <Card key={t.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} />
                    <p className="font-semibold text-gray-900 text-sm truncate">{t.nombre}</p>
                  </div>

                  {/* Barra de presencia */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>{t.trabajando + t.enPausa} / {t.totalEmpleados} presentes</span>
                      <span>{t.presenciaPct}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${t.presenciaPct}%`,
                          backgroundColor: t.color,
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-bold text-green-600">{t.trabajando}</p>
                      <p className="text-xs text-gray-400">Trab.</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-amber-500">{t.enPausa}</p>
                      <p className="text-xs text-gray-400">Pausa</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-gray-400">{t.sinFichar}</p>
                      <p className="text-xs text-gray-400">S/fichar</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
