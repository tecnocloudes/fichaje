"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EstadoCandidato } from "@/generated/prisma-tenant/client";
import {
  ESTADOS_CANDIDATO_ORDER,
  ESTADO_CANDIDATO_LABEL,
} from "@/lib/reclutamiento/labels";

interface Props {
  candidatoId: string;
  estado: EstadoCandidato;
  toneClass: string;
  label: string;
}

export function CandidatoEstadoSelect({ candidatoId, estado, toneClass, label }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [current, setCurrent] = useState(estado);

  async function change(nuevo: EstadoCandidato) {
    if (nuevo === current) return;
    setPending(true);
    try {
      const r = await fetch(`/api/candidatos/${candidatoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevo }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      setCurrent(nuevo);
      router.refresh();
    } catch {
      // revert silently
    } finally {
      setPending(false);
    }
  }

  return (
    <select
      value={current}
      disabled={pending}
      onChange={(e) => void change(e.target.value as EstadoCandidato)}
      className={`text-xs font-medium rounded-full border-0 px-2.5 py-0.5 cursor-pointer focus:ring-1 focus:ring-[var(--primary)] ${toneClass}`}
      aria-label={`Cambiar estado del candidato (actual: ${label})`}
    >
      {ESTADOS_CANDIDATO_ORDER.map((s) => (
        <option key={s} value={s}>{ESTADO_CANDIDATO_LABEL[s]}</option>
      ))}
    </select>
  );
}
