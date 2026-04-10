"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Comunicado { id: string; titulo: string; contenido: string; autor: { nombre: string; apellidos: string }; createdAt: string; }

export default function EmpleadoComunicadosPage() {
  const [comunicados, setComunicados] = useState<Comunicado[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/comunicados").then((r) => r.json()).then((d) => { setComunicados(d.comunicados || []); setLoading(false); });
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div><h1 className="text-2xl font-bold text-gray-900">Comunicados</h1><p className="text-gray-500 text-sm mt-1">Mensajes internos de la empresa</p></div>
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : comunicados.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><Megaphone className="h-10 w-10 text-gray-200 mx-auto mb-3" /><p className="text-gray-400">No hay comunicados publicados</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {comunicados.map((c) => (
            <Card key={c.id}>
              <CardContent className="pt-4 pb-4">
                <h3 className="font-semibold text-gray-900 mb-2">{c.titulo}</h3>
                <p className="text-sm text-gray-700 leading-relaxed">{c.contenido}</p>
                <p className="text-xs text-gray-400 mt-3">{c.autor.nombre} {c.autor.apellidos} · {format(new Date(c.createdAt), "d 'de' MMMM yyyy", { locale: es })}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
