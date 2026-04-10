"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { addDays, startOfWeek, endOfWeek, format, addWeeks, subWeeks, isSameDay } from "date-fns";
import { es } from "date-fns/locale";

interface Tienda { id: string; nombre: string; }
interface Empleado { id: string; nombre: string; apellidos: string; tiendaId: string | null; }
interface Turno {
  id: string; userId: string; fecha: string;
  horaInicio: string; horaFin: string; nota?: string;
  estado: "BORRADOR" | "PUBLICADO";
  user: { nombre: string; apellidos: string };
}

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export default function AdminTurnosPage() {
  const { toast } = useToast();
  const [semana, setSemana] = useState(new Date());
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [tiendaId, setTiendaId] = useState<string>("");
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ userId: "", fecha: "", horaInicio: "09:00", horaFin: "17:00", nota: "", estado: "BORRADOR" as "BORRADOR" | "PUBLICADO" });

  const inicioSemana = startOfWeek(semana, { weekStartsOn: 1 });
  const finSemana = endOfWeek(semana, { weekStartsOn: 1 });
  const dias = Array.from({ length: 7 }, (_, i) => addDays(inicioSemana, i));

  useEffect(() => {
    fetch("/api/tiendas").then(r => r.json()).then(d => {
      const lista = d.tiendas || [];
      setTiendas(lista);
      if (lista.length > 0) setTiendaId(lista[0].id);
    });
  }, []);

  const fetchData = useCallback(async () => {
    if (!tiendaId) return;
    setLoading(true);
    try {
      const [empRes, turnosRes] = await Promise.all([
        fetch(`/api/empleados?tiendaId=${tiendaId}`),
        fetch(`/api/turnos?tiendaId=${tiendaId}&fechaInicio=${inicioSemana.toISOString()}&fechaFin=${finSemana.toISOString()}`),
      ]);
      const [empData, turnosData] = await Promise.all([empRes.json(), turnosRes.json()]);
      setEmpleados(empData.empleados || []);
      setTurnos(turnosData.turnos || []);
    } finally {
      setLoading(false);
    }
  }, [tiendaId, inicioSemana.toISOString(), finSemana.toISOString()]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const turnosDeDia = (dia: Date, userId: string) =>
    turnos.filter(t => isSameDay(new Date(t.fecha), dia) && t.userId === userId);

  const handleSubmit = async () => {
    if (!form.userId || !form.fecha) {
      toast({ title: "Selecciona empleado y fecha", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/turnos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Turno creado" });
      setDialogOpen(false);
      setForm({ userId: "", fecha: "", horaInicio: "09:00", horaFin: "17:00", nota: "", estado: "BORRADOR" });
      fetchData();
    } catch {
      toast({ title: "Error al crear turno", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/turnos/${id}`, { method: "DELETE" });
      toast({ title: "Turno eliminado" });
      fetchData();
    } catch {
      toast({ title: "Error al eliminar", variant: "destructive" });
    }
  };

  const handlePublicarTodos = async () => {
    const borradores = turnos.filter(t => t.estado === "BORRADOR");
    await Promise.all(borradores.map(t =>
      fetch(`/api/turnos/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado: "PUBLICADO" }) })
    ));
    toast({ title: `${borradores.length} turnos publicados` });
    fetchData();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestión de Turnos</h1>
          <p className="text-gray-500 text-sm mt-1">{format(inicioSemana, "d MMM", { locale: es })} – {format(finSemana, "d MMM yyyy", { locale: es })}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={tiendaId} onValueChange={setTiendaId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Selecciona sede..." />
            </SelectTrigger>
            <SelectContent>
              {tiendas.map(t => <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
          {turnos.some(t => t.estado === "BORRADOR") && (
            <Button variant="outline" onClick={handlePublicarTodos}>
              <Send className="h-4 w-4 mr-2" /> Publicar todos
            </Button>
          )}
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Nuevo Turno
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setSemana(subWeeks(semana, 1))}><ChevronLeft className="h-5 w-5" /></Button>
        <span className="font-semibold text-gray-700">Semana {format(inicioSemana, "w")} de {format(inicioSemana, "yyyy")}</span>
        <Button variant="ghost" size="icon" onClick={() => setSemana(addWeeks(semana, 1))}><ChevronRight className="h-5 w-5" /></Button>
        <Button variant="ghost" size="sm" onClick={() => setSemana(new Date())}>Hoy</Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 w-40">Empleado</th>
                {dias.map((d, i) => {
                  const hoy = isSameDay(d, new Date());
                  return (
                    <th key={i} className={cn("text-center text-xs font-semibold px-2 py-3", hoy ? "text-indigo-600" : "text-gray-500")}>
                      <div>{DIAS[i]}</div>
                      <div className={cn("text-lg font-bold", hoy ? "text-indigo-700" : "text-gray-700")}>{format(d, "d")}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={8} className="px-4 py-3"><div className="h-10 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : empleados.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">{tiendaId ? "No hay empleados en esta sede" : "Selecciona una sede"}</td></tr>
              ) : (
                empleados.map(emp => (
                  <tr key={emp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-bold">
                          {emp.nombre[0]}{emp.apellidos[0]}
                        </div>
                        <span className="text-sm font-medium text-gray-800 truncate max-w-[90px]">{emp.nombre}</span>
                      </div>
                    </td>
                    {dias.map((dia, i) => {
                      const td = turnosDeDia(dia, emp.id);
                      return (
                        <td key={i} className="px-1 py-2 text-center align-top">
                          <div className="space-y-1">
                            {td.map(t => (
                              <div key={t.id} className={cn("rounded-md px-1 py-1 text-xs group relative", t.estado === "PUBLICADO" ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600 border border-dashed border-gray-300")}>
                                <div className="font-medium">{t.horaInicio}</div>
                                <div>{t.horaFin}</div>
                                <button className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" onClick={() => handleDelete(t.id)}>×</button>
                              </div>
                            ))}
                            <button className="w-full rounded-md border border-dashed border-gray-200 text-gray-300 hover:border-indigo-300 hover:text-indigo-400 transition-colors py-1 text-xs" onClick={() => { setForm(f => ({ ...f, userId: emp.id, fecha: format(dia, "yyyy-MM-dd") })); setDialogOpen(true); }}>+</button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Nuevo Turno</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Empleado</Label>
              <Select value={form.userId} onValueChange={v => setForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona empleado..." /></SelectTrigger>
                <SelectContent>{empleados.map(e => <SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fecha</Label>
              <Input type="date" className="mt-1" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Hora inicio</Label><Input type="time" className="mt-1" value={form.horaInicio} onChange={e => setForm(f => ({ ...f, horaInicio: e.target.value }))} /></div>
              <div><Label>Hora fin</Label><Input type="time" className="mt-1" value={form.horaFin} onChange={e => setForm(f => ({ ...f, horaFin: e.target.value }))} /></div>
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={form.estado} onValueChange={v => setForm(f => ({ ...f, estado: v as any }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="BORRADOR">Borrador</SelectItem><SelectItem value="PUBLICADO">Publicado</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Nota (opcional)</Label><Input className="mt-1" placeholder="Ej: Turno especial" value={form.nota} onChange={e => setForm(f => ({ ...f, nota: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Creando..." : "Crear Turno"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
