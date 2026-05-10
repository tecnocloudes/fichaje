import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const createSchema = z.object({
  espacioId: z.string().min(1),
  inicio: z.string().datetime(),
  fin: z.string().datetime(),
  motivo: z.string().max(500).nullable().optional(),
});

export const GET = withTenant(withFeature("reserva_espacios", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { searchParams } = req.nextUrl;
  const espacioId = searchParams.get("espacioId");
  const desde = searchParams.get("desde");
  const where: Record<string, unknown> = {};
  if (espacioId) where.espacioId = espacioId;
  if (desde) where.fin = { gte: new Date(desde) };
  const reservas = await prisma.reservaEspacio.findMany({
    where,
    orderBy: { inicio: "asc" },
    include: {
      user: { select: { id: true, nombre: true, apellidos: true } },
      espacio: { select: { id: true, nombre: true } },
    },
  });
  return NextResponse.json({ reservas });
}));

export const POST = withTenant(withFeature("reserva_espacios", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const inicio = new Date(parsed.data.inicio);
  const fin = new Date(parsed.data.fin);
  if (fin.getTime() <= inicio.getTime()) {
    return NextResponse.json({ error: "Fin debe ser posterior a inicio" }, { status: 400 });
  }
  // Solapamiento: cualquier reserva del mismo espacio cuyo rango cruza el nuevo.
  const overlap = await prisma.reservaEspacio.findFirst({
    where: {
      espacioId: parsed.data.espacioId,
      inicio: { lt: fin },
      fin: { gt: inicio },
    },
    select: { id: true },
  });
  if (overlap) return NextResponse.json({ error: "El espacio ya está reservado en ese tramo" }, { status: 409 });
  const reserva = await prisma.reservaEspacio.create({
    data: {
      espacioId: parsed.data.espacioId,
      userId,
      inicio, fin,
      motivo: parsed.data.motivo ?? null,
    },
    include: {
      user: { select: { id: true, nombre: true, apellidos: true } },
      espacio: { select: { id: true, nombre: true } },
    },
  });
  return NextResponse.json({ reserva }, { status: 201 });
}));
