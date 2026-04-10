"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Save, Plus, Trash2, Settings, Calendar, AlertTriangle, Bell,
  Mail, Smartphone, RefreshCw, Eye, EyeOff, Check, X, Palette, Upload, Image,
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
  // Branding
  appNombre: string;
  logo: string | null;
  favicon: string | null;
  colorPrimario: string;
  colorSidebar: string;
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

type Tab = "general" | "ausencias" | "notificaciones" | "branding";

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
    appNombre: "TelecomFichaje", logo: null, favicon: null,
    colorPrimario: "#6366f1", colorSidebar: "#1e1b4b",
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

  // ── Save branding ───────────────────────────────────────────────────────────

  const handleSaveBranding = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/configuracion/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appNombre: config.appNombre,
          nombre: config.nombre,
          logo: config.logo,
          favicon: config.favicon,
          colorPrimario: config.colorPrimario,
          colorSidebar: config.colorSidebar,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Error desconocido");
      }
      toast({ title: "Branding guardado. Recarga para ver los cambios." });
    } catch (e: unknown) {
      toast({
        title: e instanceof Error ? e.message : "Error al guardar",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = (
    field: "logo" | "favicon",
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "El archivo no puede superar 2 MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setConfig((c) => c && { ...c, [field]: reader.result as string });
    };
    reader.readAsDataURL(file);
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error desconocido");
      toast({ title: "Email de prueba enviado a tu dirección" });
    } catch (e: any) {
      toast({ title: "Error SMTP", description: e.message, variant: "destructive" });
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
        {(["general", "ausencias", "notificaciones", "branding"] as Tab[]).map((t) => {
          const labels: Record<Tab, string> = {
            general: "General",
            ausencias: "Tipos de ausencia",
            notificaciones: "Notificaciones",
            branding: "Branding",
          };
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {labels[t]}
            </button>
          );
        })}
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

      {/* ── TAB: Branding ────────────────────────────────────────────────────── */}
      {tab === "branding" && (
        <div className="space-y-6">

          {/* Identidad */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="h-4 w-4 text-indigo-600" /> Identidad de la app
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Nombre de la app</Label>
                  <Input className="mt-1" placeholder="TelecomFichaje"
                    value={config.appNombre}
                    onChange={(e) => setConfig((c) => c && ({ ...c, appNombre: e.target.value }))} />
                  <p className="text-xs text-gray-400 mt-1">Aparece en el título del navegador y emails</p>
                </div>
                <div>
                  <Label>Nombre de la empresa</Label>
                  <Input className="mt-1" placeholder="Mi Empresa"
                    value={config.nombre}
                    onChange={(e) => setConfig((c) => c && ({ ...c, nombre: e.target.value }))} />
                  <p className="text-xs text-gray-400 mt-1">Aparece en emails y cabeceras</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Colores */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="h-4 w-4 text-indigo-600" /> Colores
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <Label>Color primario</Label>
                  <p className="text-xs text-gray-400 mb-2">Botones, elementos activos, focus</p>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg border-2 border-gray-200 shadow-sm flex-shrink-0 cursor-pointer overflow-hidden relative"
                      style={{ backgroundColor: config.colorPrimario }}
                    >
                      <input
                        type="color"
                        value={config.colorPrimario}
                        onChange={(e) => setConfig((c) => c && ({ ...c, colorPrimario: e.target.value }))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                    <Input
                      value={config.colorPrimario}
                      onChange={(e) => setConfig((c) => c && ({ ...c, colorPrimario: e.target.value }))}
                      className="font-mono text-sm"
                      maxLength={7}
                      placeholder="#6366f1"
                    />
                  </div>
                  {/* Preset colors */}
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {["#6366f1","#8b5cf6","#ec4899","#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#06b6d4","#3b82f6","#1d4ed8","#374151"].map((c) => (
                      <button key={c} type="button"
                        onClick={() => setConfig((cfg) => cfg && ({ ...cfg, colorPrimario: c }))}
                        className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          borderColor: config.colorPrimario === c ? "#1f2937" : "transparent",
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <Label>Color del sidebar</Label>
                  <p className="text-xs text-gray-400 mb-2">Fondo de la barra lateral de navegación</p>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg border-2 border-gray-200 shadow-sm flex-shrink-0 cursor-pointer overflow-hidden relative"
                      style={{ backgroundColor: config.colorSidebar }}
                    >
                      <input
                        type="color"
                        value={config.colorSidebar}
                        onChange={(e) => setConfig((c) => c && ({ ...c, colorSidebar: e.target.value }))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                    <Input
                      value={config.colorSidebar}
                      onChange={(e) => setConfig((c) => c && ({ ...c, colorSidebar: e.target.value }))}
                      className="font-mono text-sm"
                      maxLength={7}
                      placeholder="#1e1b4b"
                    />
                  </div>
                  {/* Preset sidebar colors */}
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {["#1e1b4b","#0f172a","#1e293b","#111827","#1c1917","#14142b","#0a0a23","#1a1a2e","#16213e","#0d1117","#1f2937","#030712"].map((c) => (
                      <button key={c} type="button"
                        onClick={() => setConfig((cfg) => cfg && ({ ...cfg, colorSidebar: c }))}
                        className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          borderColor: config.colorSidebar === c ? "#6b7280" : "transparent",
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="mt-2 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                <div className="flex" style={{ height: "80px" }}>
                  <div className="w-28 flex flex-col" style={{ backgroundColor: config.colorSidebar }}>
                    <div className="flex items-center gap-1.5 px-2 py-2">
                      <div className="w-4 h-4 rounded flex-shrink-0" style={{ backgroundColor: config.colorPrimario }} />
                      <div className="h-2 w-12 bg-white/30 rounded" />
                    </div>
                    <div className="mx-2 rounded px-2 py-1 flex items-center gap-1" style={{ backgroundColor: config.colorPrimario }}>
                      <div className="w-2.5 h-2.5 bg-white/80 rounded-sm" />
                      <div className="h-1.5 w-10 bg-white/70 rounded" />
                    </div>
                    <div className="mx-2 mt-0.5 rounded px-2 py-1 flex items-center gap-1">
                      <div className="w-2.5 h-2.5 bg-white/30 rounded-sm" />
                      <div className="h-1.5 w-8 bg-white/25 rounded" />
                    </div>
                  </div>
                  <div className="flex-1 bg-gray-50 flex flex-col">
                    <div className="h-8 border-b border-gray-200 bg-white flex items-center px-3 gap-2">
                      <div className="h-2 w-16 bg-gray-200 rounded" />
                      <div className="ml-auto h-5 w-5 rounded-full" style={{ backgroundColor: config.colorPrimario + "40" }} />
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                      <div className="h-5 w-20 rounded" style={{ backgroundColor: config.colorPrimario }} />
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 border-t border-gray-200 px-3 py-1.5 text-center">
                  <span className="text-xs text-gray-400">Vista previa</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Logo */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Image className="h-4 w-4 text-indigo-600" /> Logo de la empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-500">El logo aparece en los emails y en la cabecera del sidebar. Formatos: PNG, JPG, SVG. Máx. 2 MB.</p>
              <div className="flex items-start gap-4">
                {/* Preview */}
                <div className="w-32 h-20 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 flex-shrink-0 overflow-hidden">
                  {config.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={config.logo} alt="Logo" className="max-w-full max-h-full object-contain p-2" />
                  ) : (
                    <div className="text-center">
                      <Image className="h-6 w-6 text-gray-300 mx-auto mb-1" />
                      <span className="text-xs text-gray-400">Sin logo</span>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="cursor-pointer">
                    <div className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700">
                      <Upload className="h-4 w-4" />
                      Subir logo
                    </div>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => handleFileUpload("logo", e)} />
                  </label>
                  {config.logo && (
                    <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600"
                      onClick={() => setConfig((c) => c && ({ ...c, logo: null }))}>
                      <X className="h-3.5 w-3.5 mr-1" /> Eliminar logo
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Favicon */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Image className="h-4 w-4 text-indigo-600" /> Favicon
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-500">Icono que aparece en la pestaña del navegador. Usa un PNG cuadrado de 32×32 o 64×64 px. Máx. 2 MB.</p>
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 flex-shrink-0 overflow-hidden">
                  {config.favicon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={config.favicon} alt="Favicon" className="w-8 h-8 object-contain" />
                  ) : (
                    <Image className="h-5 w-5 text-gray-300" />
                  )}
                </div>
                <div className="space-y-2">
                  <label className="cursor-pointer">
                    <div className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700">
                      <Upload className="h-4 w-4" />
                      Subir favicon
                    </div>
                    <input type="file" accept="image/png,image/x-icon,image/svg+xml" className="hidden"
                      onChange={(e) => handleFileUpload("favicon", e)} />
                  </label>
                  {config.favicon && (
                    <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600"
                      onClick={() => setConfig((c) => c && ({ ...c, favicon: null }))}>
                      <X className="h-3.5 w-3.5 mr-1" /> Eliminar favicon
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSaveBranding} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Guardando..." : "Guardar branding"}
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
