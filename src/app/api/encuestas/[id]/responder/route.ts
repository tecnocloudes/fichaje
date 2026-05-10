/**
 * POST /api/encuestas/[id]/responder — el empleado envía su respuesta.
 *
 * - Solo encuestas en estado `abierta` y antes de `cierraAt`.
 * - Constraint UNIQUE (encuestaId, userId) impide responder dos veces
 *   en encuestas NOMINALES. En anónimas el constraint permite varias
 *   (userId=null), pero el handler igualmente rechaza si ya hay
 *   respuesta con userId=session.user.id antes de anonimizar.
 * - Para anónimas: forzamos userId=null al insertar.
 *
 * Feature: `encuestas_clima`.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { respuestasSchema, type Pregunta } from "@/lib/encuestas/types";

const bodySchema = z.object({ respuestas: respuestasSchema });

export const POST = withTenant(withFeature("encuestas_clima", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;

    const { id } = await params;
    const encuesta = await prisma.encuesta.findUnique({
      where: { id },
      select: { estado: true, cierraAt: true, preguntas: true, anonima: true },
    });
    if (!encuesta) return NextResponse.json({ error: "Encuesta no encontrada" }, { status: 404 });
    if (encuesta.estado !== "abierta") {
      return NextResponse.json({ error: "Encuesta no disponible" }, { status: 400 });
    }
    if (encuesta.cierraAt && encuesta.cierraAt.getTime() < Date.now()) {
      return NextResponse.json({ error: "Encuesta cerrada por fecha" }, { status: 400 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    // Validar respuestas contra preguntas reales.
    const preguntas = encuesta.preguntas as unknown as Pregunta[];
    const preguntasPorIdx = new Map<number, Pregunta>(preguntas.map((p) => [p.idx, p]));
    for (const r of parsed.data.respuestas) {
      const p = preguntasPorIdx.get(r.preguntaIdx);
      if (!p) {
        return NextResponse.json(
          { error: `Pregunta ${r.preguntaIdx} no existe en la encuesta` },
          { status: 400 },
        );
      }
      if (p.tipo === "escala_1_5") {
        if (typeof r.valor !== "number" || r.valor < 1 || r.valor > 5) {
          return NextResponse.json(
            { error: `Pregunta ${p.idx}: el valor debe ser 1-5` },
            { status: 400 },
          );
        }
      } else if (p.tipo === "texto") {
        if (typeof r.valor !== "string") {
          return NextResponse.json(
            { error: `Pregunta ${p.idx}: el valor debe ser texto` },
            { status: 400 },
          );
        }
      } else if (p.tipo === "opcion") {
        if (typeof r.valor !== "string" || !p.opciones?.includes(r.valor)) {
          return NextResponse.json(
            { error: `Pregunta ${p.idx}: la opción no es válida` },
            { status: 400 },
          );
        }
      }
    }

    // Anti-doble-respuesta (también con anónimas — usamos el userId
    // real para chequear, pero al insertar lo anonimizamos).
    const existing = await prisma.respuestaEncuesta.findFirst({
      where: { encuestaId: id, userId },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "Ya has respondido esta encuesta" }, { status: 409 });
    }

    await prisma.respuestaEncuesta.create({
      data: {
        encuestaId: id,
        userId: encuesta.anonima ? null : userId,
        respuestas: parsed.data.respuestas,
      },
    });

    // Si era anónima, además registramos un placeholder con userId
    // para impedir respuesta duplicada (con respuestas vacías que NO
    // aparecen en la agregación). Esto preserva el anti-duplicado sin
    // romper el anonimato porque la fila pública anonimizada se
    // guardó arriba con userId=null.
    if (encuesta.anonima) {
      await prisma.respuestaEncuesta.create({
        data: {
          encuestaId: id,
          userId,
          respuestas: [],
        },
      });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      return NextResponse.json({ error: "Ya has respondido esta encuesta" }, { status: 409 });
    }
    console.error("POST /api/encuestas/[id]/responder error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));
