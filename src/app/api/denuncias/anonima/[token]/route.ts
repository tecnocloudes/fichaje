/**
 * Endpoint público para que un informante anónimo consulte su denuncia
 * sin login, usando el accessToken que recibió al crearla.
 *
 *   GET    /api/denuncias/anonima/[token]              → datos + comentarios públicos
 *   POST   /api/denuncias/anonima/[token]/comentarios  → añade comentario público
 *
 * El token plain solo se le mostró al informante UNA vez al crear la
 * denuncia (la BD guarda solo `accessTokenHash` = sha256(token)). Aquí
 * lo hasheamos para hacer el lookup.
 *
 * No expone comentarios internos del comité ni datos sensibles del
 * staff (asignadoUser, IP, etc.).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { hashAccessToken } from "@/lib/denuncias/access-token";

export const GET = withTenant(async (
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) => {
  const { token } = await params;
  const tokenHash = hashAccessToken(token);

  const denuncia = await prismaApp.denuncia.findUnique({
    where: { accessTokenHash: tokenHash },
    select: {
      id: true,
      asunto: true,
      categoria: true,
      descripcion: true,
      estado: true,
      esAnonima: true,
      acuseReciboAt: true,
      resolucionAt: true,
      resolucionResumen: true,
      createdAt: true,
      updatedAt: true,
      comentarios: {
        where: { esInterno: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          autorRole: true,
          contenido: true,
          createdAt: true,
        },
      },
    },
  });
  if (!denuncia) {
    return NextResponse.json({ error: "Token inválido" }, { status: 404 });
  }
  return NextResponse.json({ denuncia });
});
