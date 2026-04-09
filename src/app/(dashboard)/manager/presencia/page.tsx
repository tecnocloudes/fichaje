"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Download, Edit2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { cn, formatHora, formatFecha } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface EmpleadoPresencia {
  id: string;
  nombre: string;
  apellidos: string;
  foto?: string;
  estado: "trabajando" | "en_pausa" | "sin_fichar" | "ausente";
  horaEntrada?: string;
  horasHoy: number;
  fichajes: Array<{ tipo: string; timestamp: string }>;
}

interface FichajeEditable {
  id: string;
  tipo: string;
  timestamp: string;
  user: { nombre: string; apellidos: string };
  nota?: string;
}

const ESTADO_CONFIG = {
  trabajando: { label: "Trabajando", dot: "bg-green-500", badge: "bg-green-100 text-green-700" },
  en_pausa: { label: "En pausa", dot: "bg-amber-500", badge: "bg-amber-100 text-amber-700" },
  sin_fichar: { label: "Sin fichar", dot: "bg-gray-300", badge: "bg-gray-100 text-gray-600" },
  ausente: { label: "Ausente", dot: "bg-red-400", badge: "bg-red-100 text-red-700" },
};

export default function PresenciaPage() {
  const { toast } = useToast();
  const [empleados, setEmpleados] = useState<EmpleadoPresencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [fechaSeleccionada, setFechaSeleccionada] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");

  const fetchPresencia = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/informes?tipo=presencia&fecha=${fechaSeleccionada}`
      );
      const data = await res.json();
      setEmpleados(data.empleados || []);
    } catch {
      setEmpleados([]);
    } finally {
      setLoading(false);
    }
  }, [fechaSeleccionada]);

  useEffect(() => { fetchPresencia(); }, [fetchPresencia]);
  useEffect(() => {
    const interval = setInterval(fetchPresencia, 60000);
    return () => clearInterval(interval);
  }, [fetchPresencia]);

  const esHoy = fechaSeleccionada === new Date().toISOString().split("T")[0];

  const empleadosFiltrados = empleados.filter((e) => {
    const matchBusqueda = busqueda
      ? `${e.nombre} ${e.apellidos}`.toLowerCase().includes(busqueda.toLowerCase())
      : true;
    const matchEstado = filtroEstado === "todos" ? true : e.estado === filtroEstado;
    return matchBusqueda && matchEstado;
  });

  const stats = {
    total: empleados.length,
    trabajando: empleados.filter((e) => e.estado === "trabajando").length,
    enPausa: empleados.filter((e) => e.estado === "en_pausa").length,
    sinFichar: empleados.filter((e) => e.estado === "sin_fichar").length,
  };

  const handleExport = async () => {
    try {
      const res = await fetch(
        `/api/informes?tipo=fichajes&fechaInicio=${fechaSeleccionada}&fechaFin=${fechaSeleccionada}&formato=xlsx`
      );
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `presencia_${fechaSeleccionada}.xlsx`;
      a.click();
    } catch {
      toast({ title: "Error al exportar", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Presencia</h1>
          <p className="text-gray-500 text-sm mt-1 capitalize">
            {format(new Date(fechaSeleccionada + "T12:00:00"), "EEEE, d 'de' MMMM yyyy", { locale: es })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={fechaSeleccionada}
            max={new Date().toISOString().split("T")[0]}
            onChange={(e) => setFechaSeleccionada(e.target.value)}
            className="w-40"
          />
          <Button variant="outline" size="icon" onClick={fetchPresencia}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" /> Exportar
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total empleados", value: stats.total, color: "text-gray-700" },
          { label: "Trabajando", value: stats.trabajando, color: "text-green-600" },
          { label: "En pausa", value: stats.enPausa, color: "text-amber-600" },
          { label: "Sin fichar", value: stats.sinFichar, color: "text-gray-400" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={cn("text-3xl font-bold mt-1", s.color)}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar empleado..."
            className="pl-9"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {["todos", "trabajando", "en_pausa", "sin_fichar"].map((f) => (
            <button
              key={f}
              onClick={() => setFiltroEstado(f)}
              className={cn(
                "px-3 py-1 rounded-lg text-sm font-medium transition-all capitalize",
                filtroEstado === f
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {f === "todos" ? "Todos" : f.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : empleadosFiltrados.length === 0 ? (
            <div className="py-12 text-center text-gray-400">No se encontraron empleados</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Empleado</th>
                    <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Estado</th>
                    <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Entrada</th>
                    <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Horas hoy</th>
                    <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Fichajes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {empleadosFiltrados.map((e) => {
                    const config = ESTADO_CONFIG[e.estado];
                    return (
                      <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm">
                                {e.nombre[0]}{e.apellidos[0]}
                              </div>
                              <span className={cn("absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white", config.dot)} />
                            </div>
                            <span className="font-medium text-gray-900 text-sm">
                              {e.nombre} {e.apellidos}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", config.badge)}>
                            {config.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {e.horaEntrada ? formatHora(e.horaEntrada) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {e.horasHoy > 0 ? `${e.horasHoy.toFixed(1)}h` : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {e.fichajes.map((f, i) => (
                              <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                {f.tipo.charAt(0)} {formatHora(f.timestamp)}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
