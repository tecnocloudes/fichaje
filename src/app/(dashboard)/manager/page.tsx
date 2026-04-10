"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, UserCheck, Coffee, UserX, RefreshCw, Clock, CheckSquare, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface PersonaSimple {
  id: string;
  nombre: string;
  apellidos: string;
}

function EmpAvatar({ nombre, apellidos }: { nombre: string; apellidos: string }) {
  const initials = `${nombre[0] ?? ""}${apellidos[0] ?? ""}`.toUpperCase();
  const colors = ["bg-indigo-500", "bg-purple-500", "bg-blue-500", "bg-emerald-500", "bg-rose-500"];
  const color = colors[(nombre.charCodeAt(0) + apellidos.charCodeAt(0)) % colors.length];
  return (
    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0", color)}>
      {initials}
    </div>
  );
}

export default function ManagerDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard");
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const now = new Date();
  const greeting = now.getHours() < 14 ? "Buenos días" : now.getHours() < 21 ? "Buenas tardes" : "Buenas noches";
  const fechaFormateada = format(now, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });
  const whosIn = data?.whosIn;
  const stats = data?.stats;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">

      {/* Welcome */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-800 p-6 text-white">
        <div className="relative z-10">
          <p className="text-indigo-200 text-sm capitalize">{fechaFormateada}</p>
          <h1 className="text-2xl font-bold mt-1">{greeting} 👋</h1>
          <p className="text-indigo-200 text-sm mt-2">
            {stats ? `${stats.trabajando} empleados trabajando · ${stats.ausenciasPendientes} ausencias pendientes` : "Cargando..."}
          </p>
        </div>
        <div className="absolute right-6 top-4 opacity-10">
          <Clock className="h-24 w-24" />
        </div>
        <Button variant="ghost" size="icon" className="absolute top-4 right-4 text-white hover:bg-white/20 z-20" onClick={fetchData}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Mi equipo", value: stats?.totalEmpleados ?? "—", icon: Users, color: "text-indigo-600", bg: "bg-indigo-50" },
          { label: "Trabajando", value: stats?.trabajando ?? "—", icon: UserCheck, color: "text-green-600", bg: "bg-green-50" },
          { label: "En pausa", value: stats?.enPausa ?? "—", icon: Coffee, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Ausentes", value: stats?.ausentes ?? "—", icon: UserX, color: "text-red-500", bg: "bg-red-50" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", s.bg)}>
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

      {/* Who's in */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              {"Who's in — Mi sede"}
            </CardTitle>
            <Link href="/manager/presencia" className="text-xs text-indigo-600 hover:underline">Ver detalle →</Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}</div>
          ) : !whosIn ? null : (
            <>
              {whosIn.trabajando.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Trabajando</p>
                  <div className="flex flex-wrap gap-2">
                    {whosIn.trabajando.map((p: PersonaSimple) => (
                      <div key={p.id} className="flex items-center gap-1.5 bg-green-50 border border-green-100 rounded-full pl-1 pr-3 py-1">
                        <EmpAvatar nombre={p.nombre} apellidos={p.apellidos} />
                        <span className="text-sm font-medium text-gray-800">{p.nombre} {p.apellidos}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {whosIn.enPausa.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">En pausa</p>
                  <div className="flex flex-wrap gap-2">
                    {whosIn.enPausa.map((p: PersonaSimple) => (
                      <div key={p.id} className="flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-full pl-1 pr-3 py-1">
                        <EmpAvatar nombre={p.nombre} apellidos={p.apellidos} />
                        <span className="text-sm font-medium text-gray-800">{p.nombre} {p.apellidos}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {whosIn.sinFichar.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sin fichar</p>
                  <div className="flex flex-wrap gap-2">
                    {whosIn.sinFichar.map((p: PersonaSimple) => (
                      <div key={p.id} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full pl-1 pr-3 py-1">
                        <EmpAvatar nombre={p.nombre} apellidos={p.apellidos} />
                        <span className="text-sm text-gray-500">{p.nombre} {p.apellidos}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!whosIn.trabajando.length && !whosIn.enPausa.length && !whosIn.sinFichar.length && (
                <p className="text-gray-400 text-sm text-center py-4">No hay empleados en tu sede todavía</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "Gestionar ausencias", href: "/manager/ausencias", icon: Calendar, badge: stats?.ausenciasPendientes, color: "bg-amber-50 text-amber-700" },
          { label: "Ver turnos", href: "/manager/turnos", icon: Clock, color: "bg-indigo-50 text-indigo-700" },
          { label: "Mis tareas", href: "/manager/tareas", icon: CheckSquare, color: "bg-green-50 text-green-700" },
          { label: "Informes", href: "/manager/informes", icon: Users, color: "bg-purple-50 text-purple-700" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="relative flex items-center gap-3 p-4 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/50 transition-all group"
          >
            <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", item.color)}>
              <item.icon className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-gray-700 group-hover:text-indigo-700">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                {item.badge}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
