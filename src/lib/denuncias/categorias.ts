import type { CategoriaDenuncia, EstadoDenuncia } from "@/generated/prisma-tenant/client";

/** Etiquetas humanas (es-ES) para mostrar en la UI. */
export const CATEGORIA_LABEL: Record<CategoriaDenuncia, string> = {
  acoso_laboral: "Acoso laboral",
  acoso_sexual: "Acoso sexual",
  discriminacion: "Discriminación",
  fraude: "Fraude",
  corrupcion: "Corrupción",
  incumplimiento_normativo: "Incumplimiento normativo",
  proteccion_datos: "Protección de datos",
  seguridad_salud: "Seguridad y salud laboral",
  otro: "Otro",
};

export const ESTADO_LABEL: Record<EstadoDenuncia, string> = {
  recibida: "Recibida",
  acuse_recibido: "Acuse enviado",
  en_investigacion: "En investigación",
  resuelta: "Resuelta",
  archivada: "Archivada",
};

/** Color tone (Tailwind) por estado para badges visuales. */
export const ESTADO_TONE: Record<EstadoDenuncia, string> = {
  recibida: "bg-blue-50 text-blue-800",
  acuse_recibido: "bg-sky-50 text-sky-800",
  en_investigacion: "bg-amber-50 text-amber-800",
  resuelta: "bg-emerald-50 text-emerald-800",
  archivada: "bg-slate-100 text-slate-600",
};

export const CATEGORIAS_ORDER: CategoriaDenuncia[] = [
  "acoso_laboral",
  "acoso_sexual",
  "discriminacion",
  "fraude",
  "corrupcion",
  "incumplimiento_normativo",
  "proteccion_datos",
  "seguridad_salud",
  "otro",
];

export const ESTADOS_ORDER: EstadoDenuncia[] = [
  "recibida",
  "acuse_recibido",
  "en_investigacion",
  "resuelta",
  "archivada",
];
