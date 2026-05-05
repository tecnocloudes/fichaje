/**
 * Plazos legales de la Ley 2/2023 de protección al informante:
 *
 *   - Acuse de recibo: máx **7 días naturales** desde la recepción.
 *   - Resolución: máx **3 meses** desde la recepción (prorrogable a 6
 *     en casos justificados).
 *
 * La app calcula los plazos al vuelo a partir de `createdAt` de la
 * denuncia y muestra alertas en la UI cuando se acercan los límites.
 */

export const ACUSE_RECIBO_DIAS = 7;
export const RESOLUCION_MESES = 3;

export interface PlazoStatus {
  /** Fecha límite del plazo. */
  deadline: Date;
  /** Días restantes (puede ser negativo si vencido). */
  daysRemaining: number;
  /** "ok" (>3 días), "warning" (1-3 días), "danger" (≤0 días). */
  level: "ok" | "warning" | "danger";
  /** Texto humano: "vence en 5 días" / "vencido hace 2 días". */
  label: string;
}

export function plazoAcuseRecibo(createdAt: Date, now = new Date()): PlazoStatus {
  const deadline = new Date(createdAt);
  deadline.setDate(deadline.getDate() + ACUSE_RECIBO_DIAS);
  return summarize(deadline, now);
}

export function plazoResolucion(createdAt: Date, now = new Date()): PlazoStatus {
  const deadline = new Date(createdAt);
  deadline.setMonth(deadline.getMonth() + RESOLUCION_MESES);
  return summarize(deadline, now);
}

function summarize(deadline: Date, now: Date): PlazoStatus {
  const ms = deadline.getTime() - now.getTime();
  const daysRemaining = Math.floor(ms / (1000 * 60 * 60 * 24));
  let level: PlazoStatus["level"];
  if (daysRemaining > 3) level = "ok";
  else if (daysRemaining >= 0) level = "warning";
  else level = "danger";
  const label =
    daysRemaining < 0
      ? `Vencido hace ${Math.abs(daysRemaining)} día${Math.abs(daysRemaining) === 1 ? "" : "s"}`
      : daysRemaining === 0
        ? "Vence hoy"
        : `Vence en ${daysRemaining} día${daysRemaining === 1 ? "" : "s"}`;
  return { deadline, daysRemaining, level, label };
}
