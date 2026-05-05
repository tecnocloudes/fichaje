import type { EstadoOferta, EstadoCandidato } from "@/generated/prisma-tenant/client";

export const ESTADO_OFERTA_LABEL: Record<EstadoOferta, string> = {
  borrador: "Borrador",
  abierta: "Abierta",
  pausada: "Pausada",
  cerrada: "Cerrada",
};

export const ESTADO_OFERTA_TONE: Record<EstadoOferta, string> = {
  borrador: "bg-slate-100 text-slate-600",
  abierta: "bg-emerald-50 text-emerald-800",
  pausada: "bg-amber-50 text-amber-800",
  cerrada: "bg-slate-200 text-slate-700",
};

export const ESTADO_CANDIDATO_LABEL: Record<EstadoCandidato, string> = {
  recibido: "Recibido",
  preseleccionado: "Preseleccionado",
  entrevista: "Entrevista",
  oferta_enviada: "Oferta enviada",
  contratado: "Contratado",
  rechazado: "Rechazado",
};

export const ESTADO_CANDIDATO_TONE: Record<EstadoCandidato, string> = {
  recibido: "bg-blue-50 text-blue-800",
  preseleccionado: "bg-sky-50 text-sky-800",
  entrevista: "bg-amber-50 text-amber-800",
  oferta_enviada: "bg-purple-50 text-purple-800",
  contratado: "bg-emerald-50 text-emerald-800",
  rechazado: "bg-red-50 text-red-800",
};

export const ESTADOS_CANDIDATO_ORDER: EstadoCandidato[] = [
  "recibido",
  "preseleccionado",
  "entrevista",
  "oferta_enviada",
  "contratado",
  "rechazado",
];

export const ESTADOS_OFERTA_ORDER: EstadoOferta[] = [
  "borrador",
  "abierta",
  "pausada",
  "cerrada",
];

export function formatSalary(minCents: number | null, maxCents: number | null): string | null {
  if (minCents === null && maxCents === null) return null;
  const fmt = (c: number) => `${(c / 100).toLocaleString("es-ES")} €`;
  if (minCents !== null && maxCents !== null) return `${fmt(minCents)} - ${fmt(maxCents)}`;
  if (minCents !== null) return `Desde ${fmt(minCents)}`;
  return `Hasta ${fmt(maxCents!)}`;
}
