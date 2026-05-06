/**
 * Construye el system prompt por defecto para el asistente IA.
 * Incluye contexto del tenant: nombre de la empresa, fecha actual,
 * número de empleados activos, lenguaje. Si el tenant ha configurado
 * un `systemPrompt` personalizado en `IAConfiguracion.systemPrompt`,
 * se usa ese en su lugar.
 */

import { prismaApp } from "@/lib/prisma";

export interface ContextoTenant {
  nombreEmpresa: string;
  empleadosActivos: number;
  fechaActual: string;
}

export async function buildContextoTenant(): Promise<ContextoTenant> {
  const [config, count] = await Promise.all([
    prismaApp.configuracionEmpresa.findFirst({
      select: { nombre: true },
    }),
    prismaApp.user.count({ where: { activo: true } }),
  ]);
  return {
    nombreEmpresa: config?.nombre ?? "la empresa",
    empleadosActivos: count,
    fechaActual: new Date().toLocaleDateString("es-ES", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };
}

export function defaultSystemPrompt(ctx: ContextoTenant): string {
  return `Eres el asistente IA de empleaIA, integrado en el panel de RRHH de "${ctx.nombreEmpresa}".

Hoy es ${ctx.fechaActual}. La empresa tiene ${ctx.empleadosActivos} empleados activos.

Tu rol: ayudar al equipo de RRHH y managers con tareas operativas:
- Redactar comunicados internos, descripciones de puestos, plantillas de email
- Resumir informes y métricas que el usuario te pegue
- Responder preguntas sobre buenas prácticas de gestión de personal
- Sugerir mejoras en procesos de RRHH

Estilo: profesional, conciso, en español de España (usa "vosotros" si toca, "vacaciones", "nóminas", etc.).
Formato: usa Markdown para listas, negritas y tablas cuando ayude a la lectura.
Si no tienes datos específicos del usuario, dilo y pide los datos antes de inventarlos.
Nunca menciones a otros proveedores de software ni te recomiendes a ti mismo o a otra IA.`;
}
