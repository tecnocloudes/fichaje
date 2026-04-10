"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Save, Plus, Trash2, Settings, Calendar, AlertTriangle, Bell,
  Mail, Smartphone, RefreshCw, Eye, EyeOff, Check, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { signOut } from "next-auth/react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Configuracion {
  id: string;
  nombre: string;
  horasJornadaDiaria: number;
  horasSemanales: number;
  toleranciaFichaje: number;
  geofencingActivo: boolean;
  fichajeMovilActivo: boolean;
  fichajeTabletActivo: boolean;
  // Notificaciones globales
  notifAusencias: boolean;
  notifTurnos: boolean;
  notifTareas: boolean;
  notifFichajes: boolean;
  notifComunicados: boolean;
  // Email
  emailActivo: boolean;
  emailHost: string;
  emailPort: number;
  emailSecure: boolean;
  emailUser: string;
  emailPassword: string;
  emailFrom: string;
  // Push
  pushActivo: boolean;
  pushVapidPublicKey: string | null;
}

interface TipoAusencia {
  id: string;
  nombre: string;
  color: string;
  pagada: boolean;
  requiereAprobacion: boolean;
  diasMaximos?: number;
  activo: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COLORES = ["#6366f1", "#ef4444", "#f59e0b", "#10b981", "#ec4899", "#06b6d4", "#8b5cf6", "#f97316", "#84cc16", "#6b7280"];

const EVENTOS_NOTIF = [
  { key: "Ausencias", label: "Ausencias", desc: "Solicitudes y cambios de estado de ausencias" },
  { key: "Turnos", label: "Turnos", desc: "Publicación y modificaciones de turnos" },
  { key: "Tareas", label: "Tareas", desc: "Asignación y actualizaciones de tareas" },
  { key: "Fichajes", label: "Fichajes", desc: "Alertas de fichaje (tardanzas, ausencias)" },
  { key: "Comunicados", label: "Comunicados", desc: "Publicación de nuevos comunicados" },
] as const;

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
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
}

// ── Tab type ─────────────────────────────────────────────────────────────────

type Tab = "general" | "ausencias" | "notificaciones";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConfiguracionPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("general");
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [tipos, setTipos] = useState<TipoAusencia[]>([]);
  const [saving, setSaving] = useState(false);
  const [savingNotif, setSavingNotif] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editandoTipo, setEditandoTipo] = useState<TipoAusencia | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [generatingVapid, setGeneratingVapid] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [tipoForm, setTipoForm] = useState({
    nombre: "", color: "#6366f1", pagada: true,
    requiereAprobacion: true, diasMaximos: "",
  });

  const DEFAULT_CONFIG: Configuracion = {
    id: "singleton", nombre: "Mi Empresa",
    horasJornadaDiaria: 8, horasSemanales: 40, toleranciaFichaje: 15,
    geofencingActivo: true, fichajeMovilActivo: true, fichajeTabletActivo: true,
    notifAusencias: true, notifTurnos: true, notifTareas: true,
    notifFichajes: false, notifComunicados: true,
    emailActivo: false, emailHost: "", emailPort: 587, emailSecure: true,
    emailUser: "", emailPassword: "", emailFrom: "",
    pushActivo: false, pushVapidPublicKey: null,
  };

  const fetchData = useCallback(async () => {
    const [configRes, tipRes] = await Promise.all([
      fetch("/api/configuracion"),
      fetch("/api/ausencias/tipos"),
    ]);
    const [configData, tiposData] = await Promise.all([configRes.json(), tipRes.json()]);
    setConfig({ ...DEFAULT_CONFIG, ...configData });
    setTipos(tiposData.tipos || []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Save general ────────────────────────────────────────────────────────────

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: config.nombre,
          horasJornadaDiaria: config.horasJornadaDiaria,
          horasSemanales: config.horasSemanales,
          toleranciaFichaje: config.toleranciaFichaje,
          geofencingActivo: config.geofencingActivo,
          fichajeMovilActivo: config.fichajeMovilActivo,
          fichajeTabletActivo: config.fichajeTabletActivo,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Configuración guardada" });
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Save notifications ──────────────────────────────────────────────────────

  const handleSaveNotif = async () => {
    if (!config) return;
    setSavingNotif(true);
    try {
      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notifAusencias: config.notifAusencias,
          notifTurnos: config.notifTurnos,
          notifTareas: config.notifTareas,
          notifFichajes: config.notifFichajes,
          notifComunicados: config.notifComunicados,
          emailActivo: config.emailActivo,
          emailHost: config.emailHost,
          emailPort: config.emailPort,
          emailSecure: config.emailSecure,
          emailUser: config.emailUser,
          emailPassword: config.emailPassword,
          emailFrom: config.emailFrom,
          pushActivo: config.pushActivo,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Configuración de notificaciones guardada" });
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSavingNotif(false);
    }
  };

  // ── Generate VAPID ──────────────────────────────────────────────────────────

  const handleGenerarVapid = async () => {
    setGeneratingVapid(true);
    try {
      const res = await fetch("/api/push/generar-vapid", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setConfig((c) => c && { ...c, pushVapidPublicKey: data.publicKey });
      toast({ title: "Claves VAPID generadas correctamente" });
    } catch {
      toast({ title: "Error al generar claves VAPID", variant: "destructive" });
    } finally {
      setGeneratingVapid(false);
    }
  };

  // ── Test email ──────────────────────────────────────────────────────────────

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      const res = await fetch("/api/configuracion/test-email", { method: "POST" });
      if (!res.ok) throw new Error();
      toast({ title: "Email de prueba enviado a tu dirección" });
    } catch {
      toast({ title: "Error al enviar email de prueba. Revisa la configuración SMTP.", variant: "destructive" });
    } finally {
      setTestingEmail(false);
    }
  };

  // ── Tipo ausencia ───────────────────────────────────────────────────────────

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
      const body = { ...tipoForm, diasMaximos: tipoForm.diasMaximos ? parseInt(tipoForm.diasMaximos) : null };
      if (editandoTipo) {
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

  // ── Reset ───────────────────────────────────────────────────────────────────

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
      setTimeout(() => signOut({ callbackUrl: "/setup" }), 1500);
    } catch {
      toast({ title: "Error al reiniciar el sistema", variant: "destructive" });
      setResetting(false);
    }
  };

  if (!config) return <div className="p-6 animate-pulse"><div className="h-40 bg-gray-100 rounded-xl" /></div>;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
        <p className="text-gray-500 text-sm mt-1">Parámetros generales de la empresa</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["general", "ausencias", "notificaciones"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "general" ? "General" : t === "ausencias" ? "Tipos de ausencia" : "Notificaciones"}
          </button>
        ))}
      </div>

      {/* ── TAB: General ──────────────────────────────────────────────────────── */}
      {tab === "general" && (
        <>
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
                  <Input className="mt-1" type="number" min="1" max="24"
                    value={config.horasJornadaDiaria}
                    onChange={(e) => setConfig((c) => c && ({ ...c, horasJornadaDiaria: parseFloat(e.target.value) }))} />
                </div>
                <div>
                  <Label>Horas semanales</Label>
                  <Input className="mt-1" type="number"
                    value={config.horasSemanales}
                    onChange={(e) => setConfig((c) => c && ({ ...c, horasSemanales: parseFloat(e.target.value) }))} />
                </div>
                <div>
                  <Label>Tolerancia fichaje (min)</Label>
                  <Input className="mt-1" type="number" min="0"
                    value={config.toleranciaFichaje}
                    onChange={(e) => setConfig((c) => c && ({ ...c, toleranciaFichaje: parseInt(e.target.value) }))} />
                </div>
              </div>
              <div className="pt-2">
                <Toggle label="Geofencing activo (validar ubicación al fichar)" value={config.geofencingActivo} onChange={(v) => setConfig((c) => c && ({ ...c, geofencingActivo: v }))} />
                <Toggle label="Fichaje desde móvil" value={config.fichajeMovilActivo} onChange={(v) => setConfig((c) => c && ({ ...c, fichajeMovilActivo: v }))} />
                <Toggle label="Fichaje desde tablet (kiosko)" value={config.fichajeTabletActivo} onChange={(v) => setConfig((c) => c && ({ ...c, fichajeTabletActivo: v }))} />
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveConfig} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Guardando..." : "Guardar cambios"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Reset */}
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-4 w-4" /> Reset del sistema
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 mb-4">
                Borra <strong>todos los datos</strong>: empleados, sedes, fichajes, turnos, ausencias y configuración.
                La app quedará como nueva y mostrará el asistente de configuración inicial.
                <span className="text-red-600 font-medium"> Esta acción es irreversible.</span>
              </p>
              <Button variant="destructive" onClick={() => { setResetConfirm(""); setResetDialogOpen(true); }}>
                <Trash2 className="h-4 w-4 mr-2" /> Reiniciar sistema
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── TAB: Ausencias ────────────────────────────────────────────────────── */}
      {tab === "ausencias" && (
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
      )}

      {/* ── TAB: Notificaciones ───────────────────────────────────────────────── */}
      {tab === "notificaciones" && (
        <div className="space-y-6">

          {/* Eventos globales */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4 text-indigo-600" /> Eventos que generan notificaciones
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {EVENTOS_NOTIF.map(({ key, label, desc }) => {
                  const field = `notif${key}` as keyof Configuracion;
                  const value = config[field] as boolean;
                  return (
                    <div key={key} className="flex items-center justify-between px-6 py-3 hover:bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{label}</p>
                        <p className="text-xs text-gray-400">{desc}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfig((c) => c && { ...c, [field]: !value })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value ? "bg-indigo-600" : "bg-gray-200"}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Email (SMTP) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4 text-indigo-600" /> Correo electrónico (SMTP)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Toggle
                label="Activar notificaciones por email"
                value={config.emailActivo}
                onChange={(v) => setConfig((c) => c && ({ ...c, emailActivo: v }))}
              />
              {config.emailActivo && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Servidor SMTP</Label>
                      <Input className="mt-1" placeholder="smtp.gmail.com"
                        value={config.emailHost}
                        onChange={(e) => setConfig((c) => c && ({ ...c, emailHost: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Puerto</Label>
                      <Input className="mt-1" type="number" placeholder="587"
                        value={config.emailPort}
                        onChange={(e) => setConfig((c) => c && ({ ...c, emailPort: parseInt(e.target.value) || 587 }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Usuario</Label>
                      <Input className="mt-1" placeholder="usuario@empresa.com"
                        value={config.emailUser}
                        onChange={(e) => setConfig((c) => c && ({ ...c, emailUser: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Contraseña</Label>
                      <div className="relative mt-1">
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          value={config.emailPassword}
                          onChange={(e) => setConfig((c) => c && ({ ...c, emailPassword: e.target.value }))}
                          className="pr-9"
                        />
                        <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          onClick={() => setShowPassword((s) => !s)}>
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Remitente (From)</Label>
                      <Input className="mt-1" placeholder="noreply@empresa.com"
                        value={config.emailFrom}
                        onChange={(e) => setConfig((c) => c && ({ ...c, emailFrom: e.target.value }))} />
                    </div>
                    <div className="flex items-end">
                      <Toggle
                        label="SSL/TLS"
                        value={config.emailSecure}
                        onChange={(v) => setConfig((c) => c && ({ ...c, emailSecure: v }))}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={handleTestEmail} disabled={testingEmail}>
                      {testingEmail ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                      Enviar email de prueba
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Push */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-indigo-600" /> Notificaciones push
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Toggle
                label="Activar notificaciones push"
                value={config.pushActivo}
                onChange={(v) => setConfig((c) => c && ({ ...c, pushActivo: v }))}
              />
              {config.pushActivo && (
                <div>
                  <Label>Clave pública VAPID</Label>
                  {config.pushVapidPublicKey ? (
                    <div className="mt-1 flex items-center gap-2">
                      <code className="flex-1 text-xs bg-gray-50 border rounded px-3 py-2 text-gray-600 break-all">
                        {config.pushVapidPublicKey}
                      </code>
                      <span className="flex-shrink-0 text-green-500"><Check className="h-4 w-4" /></span>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex-1 text-xs bg-gray-50 border border-dashed rounded px-3 py-2 text-gray-400 flex items-center gap-2">
                        <X className="h-3 w-3" /> Sin claves VAPID configuradas
                      </div>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={handleGenerarVapid}
                    disabled={generatingVapid}
                  >
                    {generatingVapid ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    {config.pushVapidPublicKey ? "Regenerar claves VAPID" : "Generar claves VAPID"}
                  </Button>
                  {config.pushVapidPublicKey && (
                    <p className="text-xs text-amber-600 mt-1">
                      ⚠ Regenerar claves invalidará todas las suscripciones existentes.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSaveNotif} disabled={savingNotif}>
              <Save className="h-4 w-4 mr-2" />
              {savingNotif ? "Guardando..." : "Guardar configuración"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Dialogs ───────────────────────────────────────────────────────────── */}

      {/* Reset dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Confirmar reset del sistema
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <p className="text-sm text-gray-600">Se eliminarán <strong>todos los datos</strong> del sistema sin posibilidad de recuperación.</p>
            <div>
              <Label>Escribe <span className="font-mono font-bold text-red-600">BORRAR TODO</span> para confirmar</Label>
              <Input className="mt-1 border-red-300" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} placeholder="BORRAR TODO" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>Cancelar</Button>
            <Button variant="destructive" disabled={resetConfirm !== "BORRAR TODO" || resetting} onClick={handleReset}>
              {resetting ? "Reiniciando..." : "Confirmar reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tipo ausencia dialog */}
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
                  <button key={c} type="button"
                    className={`w-7 h-7 rounded-full border-2 transition-all ${tipoForm.color === c ? "border-gray-800 scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setTipoForm((f) => ({ ...f, color: c }))}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label>Días máximos (vacío = ilimitado)</Label>
              <Input className="mt-1" type="number" min="1" value={tipoForm.diasMaximos}
                onChange={(e) => setTipoForm((f) => ({ ...f, diasMaximos: e.target.value }))} placeholder="22" />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={tipoForm.pagada} onChange={(e) => setTipoForm((f) => ({ ...f, pagada: e.target.checked }))} className="rounded" />
                <span className="text-sm text-gray-700">Ausencia pagada</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={tipoForm.requiereAprobacion} onChange={(e) => setTipoForm((f) => ({ ...f, requiereAprobacion: e.target.checked }))} className="rounded" />
                <span className="text-sm text-gray-700">Requiere aprobación del manager</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveTipo}>{editandoTipo ? "Actualizar" : "Crear Tipo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
