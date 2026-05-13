import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const createSchema = z.object({
  tipo: z.enum(["certificado_empresa", "anticipo", "cambio_datos", "otro"]),
  titulo: z.string().min(1).max(200),
  descripcion: z.string().min(1).max(5000),
});

export const GET = withTenant(withFeature("custom_requests", async () => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  const where = userRol === Rol.OWNER || userRol === Rol.MANAGER ? {} : { solicitanteId: userId };
  const peticiones = await prisma.peticion.findMany({
    where,
    orderBy: [{ estado: "asc" }, { createdAt: "desc" }],
    include: {
      solicitante: { select: { id: true, nombre: true, apellidos: true } },
      gestor: { select: { id: true, nombre: true, apellidos: true } },
    },
  });
  return NextResponse.json({ peticiones });
}));

export const POST = withTenant(withFeature("custom_requests", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const peticion = await prisma.peticion.create({
    data: { ...parsed.data, solicitanteId: userId },
    include: { solicitante: { select: { id: true, nombre: true, apellidos: true } } },
  });
  return NextResponse.json({ peticion }, { status: 201 });
}));
