"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ClipboardList, Plus, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Peticion {
  id: string; tipo: string; titulo: string; descripcion: string;
  estado: "pendiente" | "en_proceso" | "resuelta" | "rechazada";
  respuesta: string | null;
  solicitante: { id: string; nombre: string; apellidos: string };
  gestor: { id: string; nombre: string; apellidos: string } | null;
  createdAt: string;
}

const ESTADO_CLS: Record<Peticion["estado"], string> = {
  pendiente: "bg-amber-50 text-amber-700",
  en_proceso: "bg-sky-50 text-sky-700",
  resuelta: "bg-emerald-50 text-emerald-700",
  rechazada: "bg-red-50 text-red-700",
};

const TIPOS: Record<string, string> = {
  certificado_empresa: "Certificado de empresa",
  anticipo: "Anticipo de nómina",
  cambio_datos: "Cambio de datos",
  otro: "Otro",
};

export default function CustomRequestsPage() {
  const { toast } = useToast();
  const [peticiones, setPeticiones] = useState<Peticion[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [respondiendo, setRespondiendo] = useState<Peticion | null>(null);

  const [tipo, setTipo] = useState("certificado_empresa");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [respuesta, setRespuesta] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/peticiones");
      if (r.status === 402) { setUnavailable(true); return; }
      const d = await r.json();
      setPeticiones(d.peticiones ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCreate = async () => {
    if (!titulo || !descripcion) { toast({ title: "Faltan datos", variant: "destructive" }); return; }
    const r = await fetch("/api/peticiones", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, titulo, descripcion }),
    });
    if (!r.ok) { toast({ title: "Error", variant: "destructive" }); return; }
    toast({ title: "Petición creada" });
    setOpen(false); setTitulo(""); setDescripcion("");
    await fetchAll();
  };

  const handleResponder = async (estado: Peticion["estado"]) => {
    if (!respondiendo) return;
    const r = await fetch(`/api/peticiones/${respondiendo.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado, respuesta: respuesta || null }),
    });
    if (!r.ok) return;
    toast({ title: "Actualizada" });
    setRespondiendo(null); setRespuesta("");
    await fetchAll();
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-semibold text-amber-900">Peticiones — plan Pro o superior</p></div>
            <Link href="/admin/planes"><Button size="sm">Ver planes</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><ClipboardList className="h-5 w-5 text-[var(--primary)]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Peticiones</h1>
            <p className="text-slate-500 text-sm mt-0.5">Certificados, anticipos, cambios de datos y más</p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Nueva petición</Button>
      </div>

      {loading ? <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> :
        peticiones.length === 0 ? <Card><CardContent className="py-12 text-center text-slate-500 text-sm">Sin peticiones.</CardContent></Card> : (
        <div className="space-y-3">
          {peticiones.map((p) => (
            <Card key={p.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-900">{p.titulo}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${ESTADO_CLS[p.estado]}`}>{p.estado.replace("_", " ")}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{TIPOS[p.tipo] ?? p.tipo} · {p.solicitante.nombre} {p.solicitante.apellidos}</p>
                    <p className="text-sm text-slate-600 mt-2">{p.descripcion}</p>
                    {p.respuesta && (
                      <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                        <p className="text-xs text-slate-400 mb-0.5">Respuesta de {p.gestor ? `${p.gestor.nombre} ${p.gestor.apellidos}` : "—"}:</p>
                        <p className="text-slate-700">{p.respuesta}</p>
                      </div>
                    )}
                  </div>
                  {p.estado !== "resuelta" && p.estado !== "rechazada" && (
                    <Button size="sm" variant="outline" onClick={() => { setRespondiendo(p); setRespuesta(p.respuesta ?? ""); }}>Gestionar</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva petición</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(TIPOS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div><Label>Título</Label><Input className="mt-1" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Necesito certificado de empresa" /></div>
            <div><Label>Detalle</Label><textarea className="mt-1 w-full min-h-[100px] rounded-md border border-slate-200 px-3 py-2 text-sm" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Enviar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!respondiendo} onOpenChange={(o) => !o && setRespondiendo(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Gestionar: {respondiendo?.titulo}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600">{respondiendo?.descripcion}</p>
            <div><Label>Respuesta</Label><textarea className="mt-1 w-full min-h-[100px] rounded-md border border-slate-200 px-3 py-2 text-sm" value={respuesta} onChange={(e) => setRespuesta(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleResponder("en_proceso")}>Marcar en proceso</Button>
            <Button variant="outline" className="text-red-600" onClick={() => handleResponder("rechazada")}>Rechazar</Button>
            <Button onClick={() => handleResponder("resuelta")}>Resolver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
