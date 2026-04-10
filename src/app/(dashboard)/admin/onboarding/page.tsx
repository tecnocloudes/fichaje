"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Rocket, Trash2, CheckCircle, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Proceso {
  id: string;
  tipo: string;
  estado: string;
  fechaInicio: string;
  fechaFin?: string;
  notas?: string;
  user: { id: string; nombre: string; apellidos: string; email: string; tienda?: { nombre: string } };
}

interface Empleado {
  id: string;
  nombre: string;
  apellidos: string;
}

const ESTADOS = ["PENDIENTE", "EN_PROCESO", "COMPLETADO", "CANCELADO"];
const TIPOS = ["ONBOARDING", "OFFBOARDING"];

const ESTADO_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  PENDIENTE: { label: "Pendiente", icon: Clock, color: "bg-amber-100 text-amber-700" },
  EN_PROCESO: { label: "En proceso", icon: Clock, color: "bg-blue-100 text-blue-700" },
  COMPLETADO: { label: "Completado", icon: CheckCircle, color: "bg-green-100 text-green-700" },
  CANCELADO: { label: "Cancelado", icon: XCircle, color: "bg-red-100 text-red-700" },
};

export default function AdminOnboardingPage() {
  const { toast } = useToast();
  const [procesos, setProcesos] = useState<Proceso[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState("TODOS");
  const [form, setForm] = useState({ userId: "", tipo: "ONBOARDING", estado: "PENDIENTE", fechaInicio: "", fechaFin: "", notas: "" });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [procRes, empRes] = await Promise.all([
        fetch("/api/onboarding"),
        fetch("/api/empleados"),
      ]);
      const [procData, empData] = await Promise.all([procRes.json(), empRes.json()]);
      setProcesos(procData.procesos || []);
      setEmpleados(empData.empleados || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!form.userId || !form.fechaInicio) {
      toast({ title: "Selecciona empleado y fecha de inicio", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Proceso creado" });
      setDialogOpen(false);
      setForm({ userId: "", tipo: "ONBOARDING", estado: "PENDIENTE", fechaInicio: "", fechaFin: "", notas: "" });
      fetchData();
    } catch {
      toast({ title: "Error al crear", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const updateEstado = async (id: string, estado: string) => {
    try {
      await fetch(`/api/onboarding/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/onboarding/${id}`, { method: "DELETE" });
      toast({ title: "Proceso eliminado" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const procesosFiltrados = filtroTipo === "TODOS" ? procesos : procesos.filter((p) => p.tipo === filtroTipo);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">On/Offboardings</h1>
          <p className="text-gray-500 text-sm mt-1">Gestión de incorporaciones y bajas</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo proceso
        </Button>
      </div>

      {/* Filtro tipo */}
      <div className="flex gap-2">
        {["TODOS", "ONBOARDING", "OFFBOARDING"].map((t) => (
          <button
            key={t}
            onClick={() => setFiltroTipo(t)}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-medium border transition-all capitalize",
              filtroTipo === t ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
            )}
          >
            {t === "TODOS" ? "Todos" : t.charAt(0) + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : procesosFiltrados.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Rocket className="h-10 w-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400">No hay procesos de {filtroTipo === "TODOS" ? "onboarding/offboarding" : filtroTipo.toLowerCase()}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {procesosFiltrados.map((p) => {
            const estadoConf = ESTADO_CONFIG[p.estado] ?? ESTADO_CONFIG.PENDIENTE;
            const Icon = estadoConf.icon;
            return (
              <div key={p.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border hover:shadow-sm transition-all">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", p.tipo === "ONBOARDING" ? "bg-green-50" : "bg-red-50")}>
                  <Rocket className={cn("h-5 w-5", p.tipo === "ONBOARDING" ? "text-green-600" : "text-red-600")} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-medium text-gray-900">{p.user.nombre} {p.user.apellidos}</p>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", p.tipo === "ONBOARDING" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                      {p.tipo === "ONBOARDING" ? "Onboarding" : "Offboarding"}
                    </span>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1", estadoConf.color)}>
                      <Icon className="h-3 w-3" /> {estadoConf.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    {p.user.tienda?.nombre ?? "Sin sede"} · Inicio: {format(new Date(p.fechaInicio), "d MMM yyyy", { locale: es })}
                    {p.fechaFin ? ` · Fin: ${format(new Date(p.fechaFin), "d MMM yyyy", { locale: es })}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Select value={p.estado} onValueChange={(v) => updateEstado(p.id, v)}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ESTADOS.map((e) => <SelectItem key={e} value={e} className="text-xs">{ESTADO_CONFIG[e]?.label ?? e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <button className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" onClick={() => handleDelete(p.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Nuevo proceso</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Empleado *</Label>
              <Select value={form.userId} onValueChange={(v) => setForm((f) => ({ ...f, userId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona empleado" /></SelectTrigger>
                <SelectContent>
                  {empleados.map((e) => <SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPOS.map((t) => <SelectItem key={t} value={t}>{t === "ONBOARDING" ? "Onboarding" : "Offboarding"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Estado</Label>
                <Select value={form.estado} onValueChange={(v) => setForm((f) => ({ ...f, estado: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map((e) => <SelectItem key={e} value={e}>{ESTADO_CONFIG[e]?.label ?? e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fecha inicio *</Label>
                <Input className="mt-1" type="date" value={form.fechaInicio} onChange={(e) => setForm((f) => ({ ...f, fechaInicio: e.target.value }))} />
              </div>
              <div>
                <Label>Fecha fin</Label>
                <Input className="mt-1" type="date" value={form.fechaFin} onChange={(e) => setForm((f) => ({ ...f, fechaFin: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notas</Label>
              <Input className="mt-1" value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} placeholder="Notas adicionales" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? "Creando..." : "Crear proceso"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
