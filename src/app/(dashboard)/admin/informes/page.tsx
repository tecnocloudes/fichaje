"use client";

import { useEffect, useState, useCallback } from "react";
import { FileSpreadsheet, FileText, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { subDays, format } from "date-fns";

interface Tienda { id: string; nombre: string; }
interface ResumenEmpleado {
  userId: string; nombre: string; apellidos: string;
  diasTrabajados: number; horasTotales: number; horasExtra: number; diasAusencia: number;
}
interface Stats { totalHoras: number; mediaHorasDia: number; totalAusencias: number; horasExtra: number; }

export default function AdminInformesPage() {
  const { toast } = useToast();
  const [fechaInicio, setFechaInicio] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [fechaFin, setFechaFin] = useState(format(new Date(), "yyyy-MM-dd"));
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [tiendaId, setTiendaId] = useState<string>("todas");
  const [datos, setDatos] = useState<ResumenEmpleado[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    fetch("/api/tiendas").then(r => r.json()).then(d => setTiendas(d.tiendas || []));
  }, []);

  const fetchInformes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tipo: "resumen",
        fechaInicio: `${fechaInicio}T00:00:00Z`,
        fechaFin: `${fechaFin}T23:59:59Z`,
      });
      if (tiendaId !== "todas") params.set("tiendaId", tiendaId);
      const res = await fetch(`/api/informes?${params}`);
      const data = await res.json();
      setDatos(data.empleados || []);
      setStats(data.stats || null);
    } finally {
      setLoading(false);
    }
  }, [fechaInicio, fechaFin, tiendaId]);

  useEffect(() => { fetchInformes(); }, [fetchInformes]);

  const chartData = datos.slice(0, 10).map(e => ({
    nombre: e.nombre,
    horas: parseFloat(e.horasTotales.toFixed(1)),
    extra: parseFloat(e.horasExtra.toFixed(1)),
  }));

  const handleExport = async (formato: "xlsx" | "pdf") => {
    setExportando(true);
    try {
      const params = new URLSearchParams({
        tipo: "fichajes",
        fechaInicio: `${fechaInicio}T00:00:00Z`,
        fechaFin: `${fechaFin}T23:59:59Z`,
        formato,
      });
      if (tiendaId !== "todas") params.set("tiendaId", tiendaId);
      const res = await fetch(`/api/informes?${params}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `informe_${fechaInicio}_${fechaFin}.${formato}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error al exportar", variant: "destructive" });
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Informes</h1>
          <p className="text-gray-500 text-sm mt-1">Análisis de asistencia de todas las sedes</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={exportando} onClick={() => handleExport("xlsx")}>
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
          </Button>
          <Button variant="outline" disabled={exportando} onClick={() => handleExport("pdf")}>
            <FileText className="h-4 w-4 mr-2" /> PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <Label>Sede</Label>
              <Select value={tiendaId} onValueChange={setTiendaId}>
                <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las sedes</SelectItem>
                  {tiendas.map(t => <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Desde</Label>
              <Input type="date" className="mt-1 w-40" value={fechaInicio} max={fechaFin} onChange={e => setFechaInicio(e.target.value)} />
            </div>
            <div>
              <Label>Hasta</Label>
              <Input type="date" className="mt-1 w-40" value={fechaFin} min={fechaInicio} max={format(new Date(), "yyyy-MM-dd")} onChange={e => setFechaFin(e.target.value)} />
            </div>
            <Button onClick={fetchInformes} disabled={loading}>{loading ? "Cargando..." : "Aplicar"}</Button>
          </div>
        </CardContent>
      </Card>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total horas", value: `${stats.totalHoras.toFixed(0)}h`, color: "text-indigo-600" },
            { label: "Media horas/día", value: `${stats.mediaHorasDia.toFixed(1)}h`, color: "text-gray-700" },
            { label: "Horas extra", value: `${stats.horasExtra.toFixed(0)}h`, color: "text-amber-600" },
            { label: "Ausencias", value: stats.totalAusencias.toString(), color: "text-red-500" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4 pb-4">
                <p className="text-sm text-gray-500">{s.label}</p>
                <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-indigo-600" /> Horas trabajadas por empleado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="nombre" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={v => [`${v}h`]} />
                <Bar dataKey="horas" name="Horas" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="extra" name="Extra" fill="#fbbf24" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle por empleado</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />)}</div>
          ) : datos.length === 0 ? (
            <p className="text-center py-8 text-gray-400">No hay datos para el período seleccionado</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>{["Empleado", "Días trab.", "Horas totales", "Horas extra", "Ausencias"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {datos.map(e => (
                    <tr key={e.userId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-sm text-gray-900">{e.nombre} {e.apellidos}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{e.diasTrabajados}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">{e.horasTotales.toFixed(1)}h</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={e.horasExtra > 0 ? "text-amber-600 font-medium" : "text-gray-400"}>
                          {e.horasExtra > 0 ? `+${e.horasExtra.toFixed(1)}h` : "0h"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{e.diasAusencia} días</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
