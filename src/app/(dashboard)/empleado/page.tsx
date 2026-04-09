"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Clock,
  LogIn,
  LogOut,
  Coffee,
  RotateCcw,
  MapPin,
  MapPinOff,
  Loader2,
  Store,
  CheckCircle2,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type EstadoFichaje = "sin_fichar" | "trabajando" | "en_pausa";
type TipoFichaje = "ENTRADA" | "PAUSA" | "VUELTA_PAUSA" | "SALIDA";
type LocationStatus = "checking" | "found" | "denied" | "outside" | "idle";

interface EstadoResponse {
  estaFichado: boolean;
  enPausa: boolean;
  minutosHoy: number;
  horaEntrada: string | null;
  ultimoFichaje: {
    id: string;
    tipo: TipoFichaje;
    timestamp: string;
    tienda?: { id: string; nombre: string } | null;
  } | null;
}

interface FichajeRegistro {
  id: string;
  tipo: TipoFichaje;
  timestamp: string;
  tienda?: { id: string; nombre: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DIAS_ES = [
  "Domingo", "Lunes", "Martes", "Miércoles",
  "Jueves", "Viernes", "Sábado",
];

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function formatFechaLarga(date: Date): string {
  const dia = DIAS_ES[date.getDay()];
  const num = date.getDate();
  const mes = MESES_ES[date.getMonth()];
  const anio = date.getFullYear();
  return `${dia}, ${num} de ${mes} de ${anio}`;
}

function formatHora(date: Date): string {
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatHoraCorta(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function minutosATexto(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m}m trabajadas hoy`;
  if (m === 0) return `${h}h trabajadas hoy`;
  return `${h}h ${m}m trabajadas hoy`;
}

function tipoLabel(tipo: TipoFichaje): string {
  const labels: Record<TipoFichaje, string> = {
    ENTRADA: "Entrada",
    PAUSA: "Pausa",
    VUELTA_PAUSA: "Vuelta de pausa",
    SALIDA: "Salida",
  };
  return labels[tipo];
}

function tipoColor(tipo: TipoFichaje): string {
  const colors: Record<TipoFichaje, string> = {
    ENTRADA: "bg-emerald-100 text-emerald-700",
    PAUSA: "bg-amber-100 text-amber-700",
    VUELTA_PAUSA: "bg-sky-100 text-sky-700",
    SALIDA: "bg-rose-100 text-rose-700",
  };
  return colors[tipo];
}

function calcularDistancia(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmpleadoPage() {
  const { toast } = useToast();

  // Clock
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Estado fichaje
  const [estado, setEstado] = useState<EstadoFichaje>("sin_fichar");
  const [minutosHoy, setMinutosHoy] = useState(0);
  const [tiendaNombre, setTiendaNombre] = useState<string | null>(null);
  const [fichajesHoy, setFichajesHoy] = useState<FichajeRegistro[]>([]);
  const [loadingEstado, setLoadingEstado] = useState(true);

  // Geolocation
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [distancia, setDistancia] = useState<number | undefined>(undefined);

  // Action loading
  const [loadingAction, setLoadingAction] = useState<TipoFichaje | null>(null);

  // Fetch estado
  const fetchEstado = useCallback(async () => {
    try {
      const res = await fetch("/api/fichajes/estado");
      if (!res.ok) throw new Error("Error al obtener estado");
      const data: EstadoResponse = await res.json();

      if (!data.estaFichado) {
        setEstado("sin_fichar");
      } else if (data.enPausa) {
        setEstado("en_pausa");
      } else {
        setEstado("trabajando");
      }

      setMinutosHoy(data.minutosHoy ?? 0);

      if (data.ultimoFichaje?.tienda?.nombre) {
        setTiendaNombre(data.ultimoFichaje.tienda.nombre);
      }
    } catch {
      toast({ title: "Error", description: "No se pudo obtener el estado", variant: "destructive" });
    } finally {
      setLoadingEstado(false);
    }
  }, [toast]);

  // Fetch today's fichajes
  const fetchFichajesHoy = useCallback(async () => {
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const res = await fetch(`/api/fichajes?fecha=${hoy}`);
      if (!res.ok) return;
      const data: FichajeRegistro[] = await res.json();
      setFichajesHoy(data.slice(0, 8));
      // Pick store from latest fichaje
      const conTienda = data.find((f) => f.tienda?.nombre);
      if (conTienda?.tienda?.nombre) setTiendaNombre(conTienda.tienda.nombre);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchEstado();
    fetchFichajesHoy();
  }, [fetchEstado, fetchFichajesHoy]);

  // Geolocation
  const getLocation = useCallback((): Promise<{ lat: number; lon: number }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocalización no disponible en este dispositivo"));
        return;
      }
      setLocationStatus("checking");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          setCoords(loc);
          setLocationStatus("found");
          resolve(loc);
        },
        (err) => {
          setLocationStatus("denied");
          reject(new Error(err.message));
        },
        { timeout: 10000, maximumAge: 30000 }
      );
    });
  }, []);

  // Fichar action
  const handleFichar = useCallback(
    async (tipo: TipoFichaje) => {
      setLoadingAction(tipo);
      try {
        let lat: number | undefined;
        let lon: number | undefined;
        let dist: number | undefined;

        try {
          const loc = await getLocation();
          lat = loc.lat;
          lon = loc.lon;
        } catch {
          // Location not available — proceed without it
          setLocationStatus("denied");
        }

        const res = await fetch("/api/fichajes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo, latitud: lat, longitud: lon, distancia: dist }),
        });

        const data = await res.json();

        if (!res.ok) {
          toast({
            title: "No se pudo registrar",
            description: data.error ?? "Error desconocido",
            variant: "destructive",
          });
          return;
        }

        // Update state optimistically
        switch (tipo) {
          case "ENTRADA":
            setEstado("trabajando");
            break;
          case "PAUSA":
            setEstado("en_pausa");
            break;
          case "VUELTA_PAUSA":
            setEstado("trabajando");
            break;
          case "SALIDA":
            setEstado("sin_fichar");
            break;
        }

        const labels: Record<TipoFichaje, string> = {
          ENTRADA: "Entrada registrada",
          PAUSA: "Pausa iniciada",
          VUELTA_PAUSA: "Vuelta de pausa registrada",
          SALIDA: "Salida registrada",
        };
        toast({ title: labels[tipo], description: formatHoraCorta(data.timestamp) });

        await Promise.all([fetchEstado(), fetchFichajesHoy()]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        toast({ title: "Error", description: message, variant: "destructive" });
      } finally {
        setLoadingAction(null);
      }
    },
    [getLocation, fetchEstado, fetchFichajesHoy, toast]
  );

  // ── Render helpers ────────────────────────────────────────────────────────

  function EstadoBadge() {
    if (estado === "trabajando") {
      return (
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
          <span className="text-emerald-600 font-semibold text-lg">Trabajando</span>
        </div>
      );
    }
    if (estado === "en_pausa") {
      return (
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
          </span>
          <span className="text-amber-600 font-semibold text-lg">En pausa</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <span className="relative flex h-3 w-3">
          <span className="relative inline-flex rounded-full h-3 w-3 bg-slate-400" />
        </span>
        <span className="text-slate-500 font-semibold text-lg">Sin fichar</span>
      </div>
    );
  }

  function LocationIndicator() {
    if (locationStatus === "idle") return null;
    const configs = {
      checking: { icon: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />, text: "Obteniendo ubicación…", cls: "text-blue-600" },
      found: { icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, text: "Ubicación confirmada", cls: "text-emerald-600" },
      denied: { icon: <MapPinOff className="h-4 w-4 text-amber-500" />, text: "Ubicación no disponible", cls: "text-amber-600" },
      outside: { icon: <XCircle className="h-4 w-4 text-rose-500" />, text: "Fuera del rango de la tienda", cls: "text-rose-600" },
    };
    const c = configs[locationStatus];
    return (
      <div className={cn("flex items-center gap-1.5 text-sm", c.cls)}>
        {c.icon}
        <span>{c.text}</span>
      </div>
    );
  }

  function ActionButtons() {
    const isLoading = loadingAction !== null;

    if (estado === "sin_fichar") {
      return (
        <button
          onClick={() => handleFichar("ENTRADA")}
          disabled={isLoading}
          className={cn(
            "w-full max-w-xs mx-auto flex items-center justify-center gap-3 rounded-2xl py-6 text-white text-2xl font-bold shadow-lg transition-all duration-200",
            "bg-emerald-500 hover:bg-emerald-600 active:scale-95",
            isLoading && "opacity-60 cursor-not-allowed"
          )}
        >
          {loadingAction === "ENTRADA" ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : (
            <LogIn className="h-7 w-7" />
          )}
          ENTRADA
        </button>
      );
    }

    if (estado === "trabajando") {
      return (
        <div className="flex gap-4 w-full max-w-sm mx-auto">
          <button
            onClick={() => handleFichar("PAUSA")}
            disabled={isLoading}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl py-5 text-white font-bold shadow-lg transition-all duration-200",
              "bg-amber-500 hover:bg-amber-600 active:scale-95",
              isLoading && "opacity-60 cursor-not-allowed"
            )}
          >
            {loadingAction === "PAUSA" ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Coffee className="h-6 w-6" />
            )}
            <span className="text-lg">PAUSA</span>
          </button>
          <button
            onClick={() => handleFichar("SALIDA")}
            disabled={isLoading}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl py-5 text-white font-bold shadow-lg transition-all duration-200",
              "bg-rose-500 hover:bg-rose-600 active:scale-95",
              isLoading && "opacity-60 cursor-not-allowed"
            )}
          >
            {loadingAction === "SALIDA" ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <LogOut className="h-6 w-6" />
            )}
            <span className="text-lg">SALIDA</span>
          </button>
        </div>
      );
    }

    // en_pausa
    return (
      <div className="flex gap-4 w-full max-w-sm mx-auto">
        <button
          onClick={() => handleFichar("VUELTA_PAUSA")}
          disabled={isLoading}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl py-5 text-white font-bold shadow-lg transition-all duration-200",
            "bg-emerald-500 hover:bg-emerald-600 active:scale-95",
            isLoading && "opacity-60 cursor-not-allowed"
          )}
        >
          {loadingAction === "VUELTA_PAUSA" ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <RotateCcw className="h-6 w-6" />
          )}
          <span className="text-lg">VOLVER</span>
        </button>
        <button
          onClick={() => handleFichar("SALIDA")}
          disabled={isLoading}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl py-5 text-white font-bold shadow-lg transition-all duration-200",
            "bg-rose-500 hover:bg-rose-600 active:scale-95",
            isLoading && "opacity-60 cursor-not-allowed"
          )}
        >
          {loadingAction === "SALIDA" ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <LogOut className="h-6 w-6" />
          )}
          <span className="text-lg">SALIDA</span>
        </button>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  if (loadingEstado) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
          <p className="text-sm">Cargando estado de fichaje…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Main clock card */}
      <Card
        className={cn(
          "overflow-hidden border-2 transition-colors duration-500",
          estado === "trabajando" && "border-emerald-200",
          estado === "en_pausa" && "border-amber-200",
          estado === "sin_fichar" && "border-border"
        )}
      >
        {/* Gradient accent bar */}
        <div
          className={cn(
            "h-2 w-full transition-colors duration-500",
            estado === "trabajando" && "bg-emerald-500",
            estado === "en_pausa" && "bg-amber-500",
            estado === "sin_fichar" && "bg-indigo-500"
          )}
        />

        <CardContent className="p-8 space-y-6">
          {/* Date */}
          <div className="text-center">
            <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
              {formatFechaLarga(now)}
            </p>
          </div>

          {/* Clock */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center gap-2 mb-1">
              <Clock className="h-6 w-6 text-indigo-400" />
            </div>
            <p className="text-7xl font-mono font-bold tracking-tight text-foreground tabular-nums">
              {formatHora(now)}
            </p>
          </div>

          {/* Estado + hours */}
          <div className="flex items-center justify-between px-2">
            <EstadoBadge />
            {minutosHoy > 0 && (
              <span className="text-sm text-muted-foreground font-medium">
                {minutosATexto(minutosHoy)}
              </span>
            )}
          </div>

          {/* Tienda */}
          {tiendaNombre && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
              <Store className="h-4 w-4 text-indigo-400 shrink-0" />
              <span>{tiendaNombre}</span>
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Action buttons */}
          <ActionButtons />

          {/* Location status */}
          <div className="flex justify-center">
            <LocationIndicator />
          </div>
        </CardContent>
      </Card>

      {/* Today's fichajes list */}
      {fichajesHoy.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                Registros de hoy
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {fichajesHoy.map((f) => (
                <li key={f.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        tipoColor(f.tipo)
                      )}
                    >
                      {tipoLabel(f.tipo)}
                    </span>
                  </div>
                  <span className="font-mono text-sm font-medium text-foreground">
                    {formatHoraCorta(f.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
