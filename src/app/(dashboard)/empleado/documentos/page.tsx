"use client";

import { useEffect, useState } from "react";
import { FolderOpen, FileText, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Documento { id: string; nombre: string; descripcion?: string; url?: string; tipo: string; createdAt: string; }
const TIPO_COLOR: Record<string, string> = {
  contrato: "bg-blue-100 text-blue-700", nomina: "bg-green-100 text-green-700",
  certificado: "bg-purple-100 text-purple-700", formacion: "bg-amber-100 text-amber-700", otro: "bg-gray-100 text-gray-600",
};

export default function EmpleadoDocumentosPage() {
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/documentos").then((r) => r.json()).then((d) => { setDocumentos(d.documentos || []); setLoading(false); });
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div><h1 className="text-2xl font-bold text-gray-900">Mis Documentos</h1><p className="text-gray-500 text-sm mt-1">{documentos.length} documentos disponibles</p></div>
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : documentos.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><FolderOpen className="h-10 w-10 text-gray-200 mx-auto mb-3" /><p className="text-gray-400">No tienes documentos disponibles</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {documentos.map((doc) => (
            <div key={doc.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border hover:shadow-sm transition-all">
              <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0"><FileText className="h-5 w-5 text-indigo-600" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-gray-900 truncate">{doc.nombre}</p>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium capitalize", TIPO_COLOR[doc.tipo] ?? "bg-gray-100")}>{doc.tipo}</span>
                </div>
                {doc.descripcion && <p className="text-sm text-gray-500 truncate">{doc.descripcion}</p>}
                <p className="text-xs text-gray-400 mt-0.5">{format(new Date(doc.createdAt), "d MMM yyyy", { locale: es })}</p>
              </div>
              {doc.url && <a href={doc.url} target="_blank" rel="noopener noreferrer" className="p-2 text-gray-400 hover:text-indigo-600"><Download className="h-4 w-4" /></a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
