/**
 * Tipos compartidos de encuestas. Vive aparte de los handlers para
 * poder importarse desde el cliente y el servidor sin tirar Prisma.
 */
import { z } from "zod";

export const preguntaSchema = z.object({
  idx: z.number().int().min(0),
  texto: z.string().min(1).max(500),
  tipo: z.enum(["escala_1_5", "texto", "opcion"]),
  opciones: z.array(z.string().min(1).max(200)).max(20).optional(),
});

export const preguntasSchema = z.array(preguntaSchema).min(1).max(50);

export const respuestaItemSchema = z.object({
  preguntaIdx: z.number().int().min(0),
  valor: z.union([z.number().int(), z.string().max(2000)]),
});

export const respuestasSchema = z.array(respuestaItemSchema).min(1).max(50);

export type Pregunta = z.infer<typeof preguntaSchema>;
export type RespuestaItem = z.infer<typeof respuestaItemSchema>;

export const ESTADO_ENCUESTA = ["borrador", "abierta", "cerrada"] as const;
export type EstadoEncuesta = (typeof ESTADO_ENCUESTA)[number];
