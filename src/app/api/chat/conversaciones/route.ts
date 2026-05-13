import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const createSchema = z.object({
  nombre: z.string().min(1).max(100).optional().nullable(),
  participantesIds: z.array(z.string().min(1)).min(1).max(50),
  tipo: z.enum(["directo", "grupo"]).optional(),
});

export const GET = withTenant(withFeature("chat", async () => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const convs = await prisma.conversacion.findMany({
    where: { participantes: { some: { userId } } },
    orderBy: { updatedAt: "desc" },
    include: {
      participantes: {
        include: { user: { select: { id: true, nombre: true, apellidos: true, foto: true } } },
      },
      mensajes: { orderBy: { createdAt: "desc" }, take: 1, include: { autor: { select: { id: true, nombre: true, apellidos: true } } } },
    },
  });
  // Calcular no-leídos por conv (mensajes posteriores a ultimoLeidoAt).
  const result = await Promise.all(convs.map(async (c) => {
    const meParticipante = c.participantes.find((p) => p.userId === userId);
    const noLeidos = await prisma.mensaje.count({
      where: {
        conversacionId: c.id,
        autorId: { not: userId },
        ...(meParticipante?.ultimoLeidoAt ? { createdAt: { gt: meParticipante.ultimoLeidoAt } } : {}),
      },
    });
    return { ...c, noLeidos };
  }));
  return NextResponse.json({ conversaciones: result });
}));

export const POST = withTenant(withFeature("chat", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const todos = Array.from(new Set([userId, ...parsed.data.participantesIds]));
  const tipo = parsed.data.tipo ?? (todos.length === 2 ? "directo" : "grupo");
  // Si directo, intentar reutilizar conv existente entre ambos.
  if (tipo === "directo" && todos.length === 2) {
    const otherId = todos.find((x) => x !== userId)!;
    const existing = await prisma.conversacion.findFirst({
      where: {
        tipo: "directo",
        AND: [
          { participantes: { some: { userId } } },
          { participantes: { some: { userId: otherId } } },
        ],
      },
      select: { id: true },
    });
    if (existing) return NextResponse.json({ conversacion: { id: existing.id, reusada: true } }, { status: 200 });
  }
  const conv = await prisma.conversacion.create({
    data: {
      nombre: parsed.data.nombre ?? null,
      tipo,
      creadoPorId: userId,
      participantes: { create: todos.map((uid) => ({ userId: uid })) },
    },
  });
  return NextResponse.json({ conversacion: conv }, { status: 201 });
}));
