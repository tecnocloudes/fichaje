/**
 * Validación zod del formulario /registro. ADR-003 §2.6.
 */

import { z } from "zod";

const SLUG_REGEX = /^[a-z][a-z0-9_]{2,30}$/;

export const registroSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
  email: z.string().email(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_REGEX, "Slug: minúsculas, dígitos, guion bajo; 3-31 chars; empieza por letra"),
  planKey: z.enum(["starter", "pro", "enterprise"]),
  billingPeriod: z.enum(["monthly", "yearly"]),
});

export type RegistroInput = z.infer<typeof registroSchema>;

/**
 * Sugiere alternativas para un slug ya tomado. §15.10 del plan de
 * Fase 4: si la constraint UNIQUE lanza, ofrecer 2-3 sugerencias en
 * lugar de devolver simple "ya existe" (mejor UX, sin oracle público
 * de enumeración).
 */
export function suggestSlugAlternatives(slug: string): string[] {
  const out: string[] = [];
  // <slug>2, <slug>_es, <slug>_app
  out.push(`${slug}2`);
  out.push(`${slug}_es`);
  out.push(`${slug}_app`);
  // Filtrar las que no cumplan regex (longitud >31 etc.) por si acaso.
  return out.filter((s) => SLUG_REGEX.test(s));
}
