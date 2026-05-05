import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";

const ESTADOS = [
  "recibido",
  "preseleccionado",
  "entrevista",
  "oferta_enviada",
  "contratado",
  "rechazado",
] as const;

const patchSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  notas: z.string().max(2000).optional(),
});

export const PATCH = withTenant(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  const user = session?.user as { rol?: Rol | string } | undefined;
  if (user?.rol !== Rol.OWNER && user?.rol !== Rol.MANAGER) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }
  const candidato = await prismaApp.candidato.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json({ candidato });
});
