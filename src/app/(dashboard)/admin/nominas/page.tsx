"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Calculator, Lock, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Row {
  userId: string; nombre: string; apellidos: string; email: string; dni: string | null;
  horasTotales: number; horasExtra: number; diasTrabajados: number; ausencias: number;
}

export default function PrenominaPage() {
  const [periodo, setPeriodo] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [horasTeoricas, setHorasTeoricas] = useState(0);
  const [diasLab, setDiasLab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/prenomina?periodo=${periodo}`);
      if (r.status === 402) { setUnavailable(true); return; }
      const d = await r.json();
      setRows(d.empleados ?? []);
      setHorasTeoricas(d.horasTeoricas ?? 0);
      setDiasLab(d.diasLaborables ?? 0);
    } finally { setLoading(false); }
  }, [periodo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const downloadCSV = () => {
    const headers = ["DNI", "Apellidos", "Nombre", "Email", "Días trabajados", "Horas totales", "Horas extra", "Ausencias (días)"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push([
        r.dni ?? "", `"${r.apellidos}"`, `"${r.nombre}"`, r.email,
        r.diasTrabajados, r.horasTotales, r.horasExtra, r.ausencias,
      ].join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `prenomina_${periodo}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-semibold text-amber-900">Prenómina — plan Pro o superior</p></div>
            <Link href="/admin/planes"><Button size="sm">Ver planes</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><Calculator className="h-5 w-5 text-[var(--primary)]" /></div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Prenómina</h1>
          <p className="text-slate-500 text-sm mt-0.5">Agregado mensual de horas trabajadas y ausencias — listo para tu software de nómina</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 flex items-end gap-4 flex-wrap">
          <div><Label>Periodo</Label><Input className="mt-1 w-40" type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} /></div>
          <Button onClick={fetchData}>Aplicar</Button>
          <Button variant="outline" onClick={downloadCSV} disabled={rows.length === 0}><Download className="h-4 w-4 mr-1.5" /> CSV</Button>
          <div className="ml-auto text-xs text-slate-500 self-center">{diasLab} días lab · {horasTeoricas}h teóricas</div>
        </CardContent>
      </Card>

      {loading ? <Loader2 className="h-6 w-6 animate-spin text-slate-400" /> :
        rows.length === 0 ? <Card><CardContent className="py-12 text-center text-slate-500 text-sm">Sin datos para el periodo seleccionado.</CardContent></Card> : (
        <Card>
          <CardHeader><CardTitle className="text-base">{rows.length} empleado(s)</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>{["DNI", "Empleado", "Días", "Horas", "Extras", "Ausencias"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.userId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500 tabular-nums">{r.dni ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-900">{r.nombre} {r.apellidos}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{r.diasTrabajados}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold">{r.horasTotales.toFixed(2)}h</td>
                    <td className="px-4 py-3 tabular-nums"><span className={r.horasExtra > 0 ? "text-amber-600" : "text-slate-400"}>{r.horasExtra > 0 ? `+${r.horasExtra.toFixed(2)}h` : "—"}</span></td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{r.ausencias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
