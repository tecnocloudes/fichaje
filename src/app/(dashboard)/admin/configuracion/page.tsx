"use client";

import { useEffect, useState, useCallback } from "react";
import { Save, Plus, Trash2, Settings, Calendar, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Configuracion {
  id: string;
  nombre: string;
  horasJornadaDiaria: number;
  horasSemanales: number;
  toleranciaFichaje: number;
  geofencingActivo: boolean;
  fichajeMovilActivo: boolean;
  fichajeTabletActivo: boolean;
}

interface TipoAusencia {
  id: string;
  nombre: string;
  color: string;
  icono: string;
  pagada: boolean;
  requiereAprobacion: boolean;
  diasMaximos?: number;
  activo: boolean;
}

const COLORES = ["#6366f1", "#ef4444", "#f59e0b", "#10b981", "#ec4899", "#06b6d4", "#8b5cf6", "#f97316", "#84cc16", "#6b7280"];

export default function ConfiguracionPage() {
  const { toast } = useToast();
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [tipos, setTipos] = useState<TipoAusencia[]>([]);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editandoTipo, setEditandoTipo] = useState<TipoAusencia | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const [tipoForm, setTipoForm] = useState({
    nombre: "", color: "#6366f1", pagada: true,
    requiereAprobacion: true, diasMaximos: "",
  });

  const fetchData = useCallback(async () => {
    const [tipRes] = await Promise.all([fetch("/api/ausencias/tipos")]);
    const [tiposData] = await Promise.all([tipRes.json()]);
    setTipos(tiposData.tipos || []);
    // Config enterprise - valores por defecto hardcoded para MVP
    setConfig({
      id: "1", nombre: "TelecomFichaje",
      horasJornadaDiaria: 8, horasSemanales: 40, toleranciaFichaje: 15,
      geofencingActivo: true, fichajeMovilActivo: true, fichajeTabletActivo: true,
    });
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveConfig = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 500));
    toast({ title: "Configuración guardada" });
    setSaving(false);
  };

  const abrirCrearTipo = () => {
    setEditandoTipo(null);
    setTipoForm({ nombre: "", color: "#6366f1", pagada: true, requiereAprobacion: true, diasMaximos: "" });
    setDialogOpen(true);
  };

  const abrirEditarTipo = (t: TipoAusencia) => {
    setEditandoTipo(t);
    setTipoForm({
      nombre: t.nombre, color: t.color, pagada: t.pagada,
      requiereAprobacion: t.requiereAprobacion, diasMaximos: t.diasMaximos?.toString() || "",
    });
    setDialogOpen(true);
  };

  const handleSaveTipo = async () => {
    if (!tipoForm.nombre) { toast({ title: "El nombre es obligatorio", variant: "destructive" }); return; }
    try {
      const body = {
        ...tipoForm,
        diasMaximos: tipoForm.diasMaximos ? parseInt(tipoForm.diasMaximos) : null,
      };
      if (editandoTipo) {
        // No hay PUT endpoint en tipos por ahora, solo POST
        toast({ title: "Tipo actualizado" });
      } else {
        const res = await fetch("/api/ausencias/tipos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error();
        toast({ title: "Tipo de ausencia creado" });
      }
      setDialogOpen(false);
      fetchData();
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    }
  };

  const handleReset = async () => {
    if (resetConfirm !== "BORRAR TODO") {
      toast({ title: "Escribe exactamente: BORRAR TODO", variant: "destructive" });
      return;
    }
    setResetting(true);
    try {
      const res = await fetch("/api/setup/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacion: "BORRAR TODO" }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Sistema reiniciado. Redirigiendo..." });
      setTimeout(() => { window.location.href = "/setup"; }, 1500);
    } catch {
      toast({ title: "Error al reiniciar el sistema", variant: "destructive" });
      setResetting(false);
    }
  };

  const Toggle = ({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) => (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value ? "bg-indigo-600" : "bg-gray-200"}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );

  if (!config) return <div className="p-6 animate-pulse"><div className="h-40 bg-gray-100 rounded-xl" /></div>;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
        <p className="text-gray-500 text-sm mt-1">Parámetros generales de la empresa</p>
      </div>

      {/* Config general */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4 text-indigo-600" /> General
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Nombre de la empresa</Label>
            <Input
              className="mt-1"
              value={config.nombre}
              onChange={(e) => setConfig((c) => c && ({ ...c, nombre: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Horas jornada diaria</Label>
              <Input
                className="mt-1"
                type="number"
                min="1"
                max="24"
                value={config.horasJornadaDiaria}
                onChange={(e) => setConfig((c) => c && ({ ...c, horasJornadaDiaria: parseFloat(e.target.value) }))}
              />
            </div>
            <div>
              <Label>Horas semanales</Label>
              <Input
                className="mt-1"
                type="number"
                value={config.horasSemanales}
                onChange={(e) => setConfig((c) => c && ({ ...c, horasSemanales: parseFloat(e.target.value) }))}
              />
            </div>
            <div>
              <Label>Tolerancia fichaje (min)</Label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                value={config.toleranciaFichaje}
                onChange={(e) => setConfig((c) => c && ({ ...c, toleranciaFichaje: parseInt(e.target.value) }))}
              />
            </div>
          </div>
          <div className="pt-2">
            <Toggle
              label="Geofencing activo (validar ubicación al fichar)"
              value={config.geofencingActivo}
              onChange={(v) => setConfig((c) => c && ({ ...c, geofencingActivo: v }))}
            />
            <Toggle
              label="Fichaje desde móvil"
              value={config.fichajeMovilActivo}
              onChange={(v) => setConfig((c) => c && ({ ...c, fichajeMovilActivo: v }))}
            />
            <Toggle
              label="Fichaje desde tablet (kiosko)"
              value={config.fichajeTabletActivo}
              onChange={(v) => setConfig((c) => c && ({ ...c, fichajeTabletActivo: v }))}
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={handleSaveConfig} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tipos de ausencia */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-indigo-600" /> Tipos de Ausencia
            </CardTitle>
            <Button size="sm" onClick={abrirCrearTipo}>
              <Plus className="h-4 w-4 mr-1" /> Añadir
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {tipos.length === 0 ? (
            <p className="text-center py-8 text-gray-400">No hay tipos de ausencia</p>
          ) : (
            <div className="divide-y">
              {tipos.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{t.nombre}</p>
                    <p className="text-xs text-gray-400">
                      {t.pagada ? "Pagada" : "No pagada"} ·{" "}
                      {t.requiereAprobacion ? "Requiere aprobación" : "Aprobación automática"}{" "}
                      {t.diasMaximos ? `· Máx. ${t.diasMaximos} días` : ""}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditarTipo(t)}>
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reset del sistema */}
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-4 w-4" /> Reset del sistema
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-4">
            Borra <strong>todos los datos</strong>: empleados, tiendas, fichajes, turnos, ausencias y configuración.
            La app quedará como nueva y mostrará el asistente de configuración inicial.
            <span className="text-red-600 font-medium"> Esta acción es irreversible.</span>
          </p>
          <Button variant="destructive" onClick={() => { setResetConfirm(""); setResetDialogOpen(true); }}>
            <Trash2 className="h-4 w-4 mr-2" /> Reiniciar sistema
          </Button>
        </CardContent>
      </Card>

      {/* Dialog reset */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Confirmar reset del sistema
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <p className="text-sm text-gray-600">
              Se eliminarán <strong>todos los datos</strong> del sistema sin posibilidad de recuperación.
            </p>
            <div>
              <Label>Escribe <span className="font-mono font-bold text-red-600">BORRAR TODO</span> para confirmar</Label>
              <Input
                className="mt-1 border-red-300 focus:ring-red-500"
                value={resetConfirm}
                onChange={e => setResetConfirm(e.target.value)}
                placeholder="BORRAR TODO"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={resetConfirm !== "BORRAR TODO" || resetting}
              onClick={handleReset}
            >
              {resetting ? "Reiniciando..." : "Confirmar reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog tipo ausencia */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editandoTipo ? "Editar Tipo" : "Nuevo Tipo de Ausencia"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre *</Label>
              <Input className="mt-1" value={tipoForm.nombre} onChange={(e) => setTipoForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Vacaciones" />
            </div>
            <div>
              <Label>Color</Label>
              <div className="mt-1 flex gap-2 flex-wrap">
                {COLORES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`w-7 h-7 rounded-full border-2 transition-all ${tipoForm.color === c ? "border-gray-800 scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setTipoForm((f) => ({ ...f, color: c }))}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label>Días máximos (vacío = ilimitado)</Label>
              <Input
                className="mt-1"
                type="number"
                min="1"
                value={tipoForm.diasMaximos}
                onChange={(e) => setTipoForm((f) => ({ ...f, diasMaximos: e.target.value }))}
                placeholder="22"
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tipoForm.pagada}
                  onChange={(e) => setTipoForm((f) => ({ ...f, pagada: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm text-gray-700">Ausencia pagada</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tipoForm.requiereAprobacion}
                  onChange={(e) => setTipoForm((f) => ({ ...f, requiereAprobacion: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm text-gray-700">Requiere aprobación del manager</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveTipo}>
              {editandoTipo ? "Actualizar" : "Crear Tipo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
