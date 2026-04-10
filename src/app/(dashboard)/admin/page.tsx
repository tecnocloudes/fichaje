"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, UserCheck, UserX, Coffee, RefreshCw, CheckSquare, Calendar, Megaphone, Gift, Flag, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { format, isToday, isTomorrow } from "date-fns";
import { es } from "date-fns/locale";

interface PersonaSimple {
  id: string;
  nombre: string;
  apellidos: string;
}

interface WhosIn {
  trabajando: PersonaSimple[];
  enPausa: PersonaSimple[];
  sinFichar: PersonaSimple[];
  ausente: PersonaSimple[];
  salida: PersonaSimple[];
}

interface Cumpleano {
  id: string;
  nombre: string;
  apellidos: string;
  fecha: string;
  diasRestantes: number;
}

interface Festivo {
  id: string;
  nombre: string;
  fecha: string;
  ambito: string;
}

interface Tarea {
  id: string;
  titulo: string;
  prioridad: string;
  fechaLimite?: string;
  asignadoA?: { nombre: string; apellidos: string };
}

interface Stats {
  totalEmpleados: number;
  trabajando: number;
  enPausa: number;
  ausentes: number;
  sinFichar: number;
  ausenciasPendientes: number;
}

function Avatar({ nombre, apellidos, size = "sm" }: { nombre: string; apellidos: string; size?: "sm" | "md" }) {
  const initials = `${nombre[0] ?? ""}${apellidos[0] ?? ""}`.toUpperCase();
  const colors = ["bg-indigo-500", "bg-purple-500", "bg-blue-500", "bg-emerald-500", "bg-rose-500", "bg-amber-500"];
  const color = colors[(nombre.charCodeAt(0) + apellidos.charCodeAt(0)) % colors.length];
  return (
    <div className={cn(
      "rounded-full flex items-center justify-center text-white font-semibold shrink-0",
      size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm",
      color
    )}>
      {initials}
    </div>
  );
}

const PRIORIDAD_COLOR: Record<string, string> = {
  ALTA: "bg-red-100 text-red-700",
  MEDIA: "bg-amber-100 text-amber-700",
  BAJA: "bg-gray-100 text-gray-600",
};

export default function AdminDashboardPage() {
  const [data, setData] = useState<{
    whosIn: WhosIn;
    proximosCumpleanos: Cumpleano[];
    proximosFestivos: Festivo[];
    tareasActivas: Tarea[];
    stats: Stats;
  } | null>(null);
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

  const stats = data?.stats;
  const whosIn = data?.whosIn;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Welcome banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-800 p-6 text-white">
        <div className="relative z-10">
          <p className="text-indigo-200 text-sm capitalize">{fechaFormateada}</p>
          <h1 className="text-2xl font-bold mt-1">{greeting} 👋</h1>
          <p className="text-indigo-200 text-sm mt-2">
            {stats
              ? `${stats.trabajando} empleados trabajando ahora · ${stats.ausenciasPendientes} ausencias pendientes`
              : "Cargando datos..."}
          </p>
        </div>
        <div className="absolute right-6 top-4 opacity-10">
          <Clock className="h-24 w-24" />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-4 text-white hover:bg-white/20 z-20"
          onClick={fetchData}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Empleados", value: stats?.totalEmpleados ?? "—", icon: Users, color: "text-indigo-600", bg: "bg-indigo-50" },
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

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Who's in (2/3 width) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Who&apos;s in
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
              </div>
            ) : !whosIn ? null : (
              <>
                {whosIn.trabajando.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Trabajando</p>
                    <div className="flex flex-wrap gap-2">
                      {whosIn.trabajando.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 bg-green-50 border border-green-100 rounded-full pl-1 pr-3 py-1">
                          <Avatar nombre={p.nombre} apellidos={p.apellidos} />
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
                      {whosIn.enPausa.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-full pl-1 pr-3 py-1">
                          <Avatar nombre={p.nombre} apellidos={p.apellidos} />
                          <span className="text-sm font-medium text-gray-800">{p.nombre} {p.apellidos}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {whosIn.ausente.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ausentes</p>
                    <div className="flex flex-wrap gap-2">
                      {whosIn.ausente.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 bg-red-50 border border-red-100 rounded-full pl-1 pr-3 py-1">
                          <Avatar nombre={p.nombre} apellidos={p.apellidos} />
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
                      {whosIn.sinFichar.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full pl-1 pr-3 py-1">
                          <Avatar nombre={p.nombre} apellidos={p.apellidos} />
                          <span className="text-sm text-gray-500">{p.nombre} {p.apellidos}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!whosIn.trabajando.length && !whosIn.enPausa.length && !whosIn.ausente.length && !whosIn.sinFichar.length && (
                  <p className="text-gray-400 text-sm text-center py-6">No hay empleados registrados todavía</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-4">
          {/* Próximos cumpleaños */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Gift className="h-4 w-4 text-pink-500" /> Próximos cumpleaños
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data?.proximosCumpleanos.length ? (
                <p className="text-sm text-gray-400 py-2">Sin cumpleaños próximos</p>
              ) : (
                <div className="space-y-3">
                  {data.proximosCumpleanos.map((c) => {
                    const fecha = new Date(c.fecha);
                    const label = c.diasRestantes === 0 ? "¡Hoy!" : c.diasRestantes === 1 ? "Mañana" : format(fecha, "d MMM", { locale: es });
                    return (
                      <div key={c.id} className="flex items-center gap-3">
                        <Avatar nombre={c.nombre} apellidos={c.apellidos} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{c.nombre} {c.apellidos}</p>
                          <p className="text-xs text-gray-500">{label}</p>
                        </div>
                        {c.diasRestantes === 0 && <span className="text-lg">🎂</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Próximos festivos */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Flag className="h-4 w-4 text-indigo-500" /> Próximos festivos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data?.proximosFestivos.length ? (
                <div className="space-y-1">
                  <p className="text-sm text-gray-400">Sin festivos configurados</p>
                  <Link href="/admin/configuracion" className="text-xs text-indigo-600 hover:underline">Añadir festivos →</Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.proximosFestivos.map((f) => {
                    const fecha = new Date(f.fecha);
                    return (
                      <div key={f.id} className="flex items-center gap-3">
                        <div className="text-center w-10 shrink-0">
                          <p className="text-xs text-gray-400 uppercase">{format(fecha, "MMM", { locale: es })}</p>
                          <p className="text-lg font-bold text-indigo-700 leading-tight">{format(fecha, "d")}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{f.nombre}</p>
                          <p className="text-xs text-gray-400 capitalize">{f.ambito}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Tareas activas */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-indigo-600" /> Tareas activas
              </CardTitle>
              <Link href="/admin/tareas" className="text-xs text-indigo-600 hover:underline">Ver todas →</Link>
            </div>
          </CardHeader>
          <CardContent>
            {!data?.tareasActivas.length ? (
              <div className="text-center py-6">
                <CheckSquare className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No hay tareas activas</p>
                <Link href="/admin/tareas" className="text-xs text-indigo-600 hover:underline mt-1 block">Crear tarea →</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {data.tareasActivas.map((t) => (
                  <div key={t.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{t.titulo}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", PRIORIDAD_COLOR[t.prioridad] ?? "bg-gray-100 text-gray-600")}>
                          {t.prioridad}
                        </span>
                        {t.asignadoA && (
                          <span className="text-xs text-gray-400">{t.asignadoA.nombre} {t.asignadoA.apellidos}</span>
                        )}
                        {t.fechaLimite && (
                          <span className="text-xs text-gray-400">{format(new Date(t.fechaLimite), "d MMM", { locale: es })}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Accesos rápidos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Accesos rápidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Empleados", href: "/admin/empleados", icon: Users, color: "bg-blue-50 text-blue-700" },
                { label: "Ausencias", href: "/admin/ausencias", icon: Calendar, color: "bg-amber-50 text-amber-700", badge: stats?.ausenciasPendientes },
                { label: "Comunicados", href: "/admin/comunicados", icon: Megaphone, color: "bg-purple-50 text-purple-700" },
                { label: "Informes", href: "/admin/informes", icon: CheckSquare, color: "bg-green-50 text-green-700" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="relative flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/50 transition-all group"
                >
                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", item.color)}>
                    <item.icon className="h-4 w-4" />
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
