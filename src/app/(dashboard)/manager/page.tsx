"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Users, Clock, Coffee, XCircle, CheckCircle, X, RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type EstadoPresencia = "TRABAJANDO" | "EN_PAUSA" | "SIN_FICHAR" | "AUSENTE";

interface EmpleadoPresencia {
  id: string;
  nombre: string;
  apellidos: string;
  estado: EstadoPresencia;
  horaEntrada?: string;
  horasTrabajadas: number;
}

interface Ausencia {
  id: string;
  userId: string;
  user: { nombre: string; apellidos: string };
  tipoAusencia: { nombre: string; color: string };
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  motivo?: string;
  estado: string;
}

interface Turno {
  id: string;
  userId: string;
  user: { nombre: string; apellidos: string };
  horaInicio: string;
  horaFin: string;
  nota?: string;
  estado: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(nombre: string, apellidos: string) {
  return `${nombre[0] ?? ""}${apellidos[0] ?? ""}`.toUpperCase();
}

function estadoConfig(estado: EstadoPresencia) {
  switch (estado) {
    case "TRABAJANDO":
      return { dot: "bg-emerald-500", label: "Trabajando", badge: "success" as const };
    case "EN_PAUSA":
      return { dot: "bg-amber-500", label: "En pausa", badge: "warning" as const };
    case "SIN_FICHAR":
      return { dot: "bg-gray-400", label: "Sin fichar", badge: "secondary" as const };
    case "AUSENTE":
      return { dot: "bg-red-500", label: "Ausente", badge: "destructive" as const };
  }
}

function calcEstado(fichajes: Array<{ tipo: string; timestamp: string }>): EstadoPresencia {
  if (!fichajes.length) return "SIN_FICHAR";
  const sorted = [...fichajes].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const last = sorted[sorted.length - 1];
  if (last.tipo === "ENTRADA" || last.tipo === "VUELTA_PAUSA") return "TRABAJANDO";
  if (last.tipo === "PAUSA") return "EN_PAUSA";
  return "SIN_FICHAR";
}

function formatHoras(h: number) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}h ${mins.toString().padStart(2, "0")}m`;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-4">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${color}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ManagerDashboard() {
  const { toast } = useToast();

  const [presencia, setPresencia] = useState<EmpleadoPresencia[]>([]);
  const [ausencias, setAusencias] = useState<Ausencia[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const today = new Date().toISOString().split("T")[0];

      const [fichajesRes, ausenciasRes, turnosRes] = await Promise.all([
        fetch(`/api/fichajes?fecha=${today}`),
        fetch(`/api/ausencias?estado=PENDIENTE`),
        fetch(`/api/turnos?fechaInicio=${today}&fechaFin=${today}`),
      ]);

      if (!fichajesRes.ok || !ausenciasRes.ok || !turnosRes.ok) {
        throw new Error("Error al cargar datos");
      }

      const [fichajesData, ausenciasData, turnosData] = await Promise.all([
        fichajesRes.json(),
        ausenciasRes.json(),
        turnosRes.json(),
      ]);

      // Build presence map per user
      const byUser = new Map<string, { user: { id: string; nombre: string; apellidos: string }; fichajes: Array<{ tipo: string; timestamp: string }> }>();
      for (const f of fichajesData) {
        if (!byUser.has(f.userId)) {
          byUser.set(f.userId, { user: f.user, fichajes: [] });
        }
        byUser.get(f.userId)!.fichajes.push({ tipo: f.tipo, timestamp: f.timestamp });
      }

      const presenciaList: EmpleadoPresencia[] = Array.from(byUser.values()).map(({ user, fichajes }) => {
        const estado = calcEstado(fichajes);
        const entradaFichaje = fichajes
          .filter((f) => f.tipo === "ENTRADA")
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];

        let horasTrabajadas = 0;
        let entry: Date | null = null;
        let inPausa = false;
        const sorted = [...fichajes].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        for (const f of sorted) {
          const ts = new Date(f.timestamp);
          if (f.tipo === "ENTRADA") { entry = ts; inPausa = false; }
          else if (f.tipo === "VUELTA_PAUSA") { entry = ts; inPausa = false; }
          else if (f.tipo === "PAUSA") { inPausa = true; }
          else if (f.tipo === "SALIDA" && entry && !inPausa) {
            horasTrabajadas += (ts.getTime() - entry.getTime()) / 3600000;
            entry = null;
          }
        }
        if (entry && !inPausa) {
          horasTrabajadas += (Date.now() - entry.getTime()) / 3600000;
        }

        return {
          id: user.id,
          nombre: user.nombre,
          apellidos: user.apellidos,
          estado,
          horaEntrada: entradaFichaje
            ? new Date(entradaFichaje.timestamp).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
            : undefined,
          horasTrabajadas: Math.round(horasTrabajadas * 100) / 100,
        };
      });

      setPresencia(presenciaList);
      setAusencias(ausenciasData);
      setTurnos(turnosData);
      setLastUpdate(new Date());
    } catch {
      toast({ title: "Error", description: "No se pudieron cargar los datos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  async function handleAusencia(id: string, action: "APROBADA" | "RECHAZADA") {
    try {
      const body: Record<string, string> = { estado: action };
      if (action === "RECHAZADA" && rejectReason) body.comentarioAdmin = rejectReason;

      const res = await fetch(`/api/ausencias/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error();

      toast({
        title: action === "APROBADA" ? "Ausencia aprobada" : "Ausencia rechazada",
        description: "La solicitud ha sido procesada correctamente.",
      });
      setRejectId(null);
      setRejectReason("");
      fetchData();
    } catch {
      toast({ title: "Error", description: "No se pudo procesar la solicitud", variant: "destructive" });
    }
  }

  const stats = {
    total: presencia.length,
    trabajando: presencia.filter((e) => e.estado === "TRABAJANDO").length,
    pausa: presencia.filter((e) => e.estado === "EN_PAUSA").length,
    ausentes: presencia.filter((e) => e.estado === "AUSENTE" || e.estado === "SIN_FICHAR").length,
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Panel de Manager</h1>
          <p className="text-sm text-muted-foreground">
            Última actualización: {lastUpdate.toLocaleTimeString("es-ES")} · Actualización automática cada 30s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Actualizar
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label="Total empleados hoy" value={stats.total} color="bg-indigo-500" />
        <StatCard icon={Clock} label="Fichados ahora" value={stats.trabajando} color="bg-emerald-500" />
        <StatCard icon={Coffee} label="En pausa" value={stats.pausa} color="bg-amber-500" />
        <StatCard icon={XCircle} label="Ausentes / Sin fichar" value={stats.ausentes} color="bg-red-500" />
      </div>

      {/* Main content */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Presencia en tiempo real */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              Presencia en tiempo real
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {presencia.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                <Users className="h-8 w-8 opacity-40" />
                <p className="text-sm">No hay empleados registrados hoy</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {presencia.map((emp) => {
                  const cfg = estadoConfig(emp.estado);
                  return (
                    <div key={emp.id} className="flex items-center gap-4 px-6 py-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="text-xs">
                          {getInitials(emp.nombre, emp.apellidos)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium text-sm">
                          {emp.nombre} {emp.apellidos}
                        </p>
                        {emp.horaEntrada && (
                          <p className="text-xs text-muted-foreground">
                            Entrada: {emp.horaEntrada}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground font-mono">
                          {formatHoras(emp.horasTrabajadas)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                          <Badge variant={cfg.badge} className="text-xs">
                            {cfg.label}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-6">
          {/* Solicitudes pendientes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Solicitudes pendientes
                {ausencias.length > 0 && (
                  <Badge className="ml-2" variant="default">
                    {ausencias.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ausencias.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No hay solicitudes pendientes
                </p>
              ) : (
                ausencias.map((aus) => (
                  <div key={aus.id} className="rounded-lg border border-border p-3 space-y-2">
                    {rejectId === aus.id ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Motivo del rechazo:</p>
                        <textarea
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                          rows={2}
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Opcional..."
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="flex-1 text-xs h-7"
                            onClick={() => handleAusencia(aus.id, "RECHAZADA")}
                          >
                            Confirmar rechazo
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-7"
                            onClick={() => setRejectId(null)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">
                              {aus.user.nombre} {aus.user.apellidos}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {aus.tipoAusencia.nombre} · {aus.dias} día{aus.dias !== 1 ? "s" : ""}
                            </p>
                          </div>
                          <span
                            className="h-2 w-2 rounded-full shrink-0 mt-1"
                            style={{ backgroundColor: aus.tipoAusencia.color }}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="flex-1 text-xs h-7 bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => handleAusencia(aus.id, "APROBADA")}
                          >
                            <CheckCircle className="mr-1 h-3 w-3" />
                            Aprobar
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="flex-1 text-xs h-7"
                            onClick={() => setRejectId(aus.id)}
                          >
                            <XCircle className="mr-1 h-3 w-3" />
                            Rechazar
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Turnos de hoy */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Turnos de hoy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {turnos.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No hay turnos planificados para hoy
                </p>
              ) : (
                turnos.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">
                        {t.user.nombre} {t.user.apellidos}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {t.horaInicio} – {t.horaFin}
                      </p>
                    </div>
                    <Badge
                      variant={t.estado === "PUBLICADO" ? "success" : "secondary"}
                      className="text-xs ml-2 shrink-0"
                    >
                      {t.estado === "PUBLICADO" ? "Publicado" : "Borrador"}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
