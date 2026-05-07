/**
 * POST /api/denuncias/anonima/[token]/comentarios
 *
 * El informante anónimo añade un comentario a su propia denuncia
 * usando el token que recibió al crearla. NO permite marcar el
 * comentario como interno.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { hashAccessToken } from "@/lib/denuncias/access-token";

const schema = z.object({
  contenido: z.string().min(1).max(5000),
});

export const POST = withTenant(async (
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) => {
  const { token } = await params;
  const tokenHash = hashAccessToken(token);

  const denuncia = await prismaApp.denuncia.findUnique({
    where: { accessTokenHash: tokenHash },
    select: { id: true, estado: true },
  });
  if (!denuncia) {
    return NextResponse.json({ error: "Token inválido" }, { status: 404 });
  }
  if (denuncia.estado === "archivada") {
    return NextResponse.json(
      { error: "Esta denuncia ya está archivada" },
      { status: 409 },
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }

  const comentario = await prismaApp.comentarioDenuncia.create({
    data: {
      denunciaId: denuncia.id,
      autorUserId: null,
      autorRole: "informante",
      contenido: parsed.data.contenido,
      esInterno: false,
    },
    select: { id: true, contenido: true, createdAt: true, autorRole: true },
  });

  return NextResponse.json({ comentario }, { status: 201 });
});
