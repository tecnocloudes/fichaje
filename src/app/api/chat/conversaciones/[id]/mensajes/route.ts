import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const createSchema = z.object({ texto: z.string().min(1).max(5000) });

async function assertParticipante(convId: string, userId: string) {
  return prisma.participanteConversacion.findUnique({
    where: { conversacionId_userId: { conversacionId: convId, userId } },
    select: { id: true },
  });
}

export const GET = withTenant(withFeature("chat", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const { id } = await params;
  const part = await assertParticipante(id, userId);
  if (!part) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const since = searchParams.get("since");
  const mensajes = await prisma.mensaje.findMany({
    where: { conversacionId: id, ...(since ? { createdAt: { gt: new Date(since) } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { autor: { select: { id: true, nombre: true, apellidos: true, foto: true } } },
  });
  // Marcar como leído.
  await prisma.participanteConversacion.update({
    where: { conversacionId_userId: { conversacionId: id, userId } },
    data: { ultimoLeidoAt: new Date() },
  });
  return NextResponse.json({ mensajes });
}));

export const POST = withTenant(withFeature("chat", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const { id } = await params;
  const part = await assertParticipante(id, userId);
  if (!part) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const mensaje = await prisma.mensaje.create({
    data: { conversacionId: id, autorId: userId, texto: parsed.data.texto },
    include: { autor: { select: { id: true, nombre: true, apellidos: true, foto: true } } },
  });
  await prisma.conversacion.update({ where: { id }, data: { updatedAt: new Date() } });
  return NextResponse.json({ mensaje }, { status: 201 });
}));
