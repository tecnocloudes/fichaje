import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const patchSchema = z.object({ completado: z.boolean() });

export const PUT = withTenant(withFeature("formacion", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const { id } = await params;
  const a = await prisma.asignacionCurso.findUnique({ where: { id }, select: { empleadoId: true } });
  if (!a) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (a.empleadoId !== userId) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const updated = await prisma.asignacionCurso.update({
    where: { id },
    data: {
      completado: parsed.data.completado,
      completadoAt: parsed.data.completado ? new Date() : null,
    },
    include: { curso: true },
  });
  return NextResponse.json({ asignacion: updated });
}));
