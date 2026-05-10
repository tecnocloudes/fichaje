/**
 * GET /api/fichajes/[id]/foto — devuelve la foto cifrada del fichaje
 * decodificada. Solo OWNER y MANAGER (este último restringido a
 * fichajes de su tienda).
 *
 * La foto es un dato biométrico (RGPD art. 9). Solo se almacena cuando
 * el OWNER activó `faceIdGuardarFoto` en ConfiguracionEmpresa y el
 * fichaje vino del flujo Face ID.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { decrypt } from "@/lib/crypto/aes-gcm";

export const GET = withTenant(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const userRol = (session.user as { rol?: Rol }).rol;
  const userTiendaId = (session.user as { tiendaId?: string | null }).tiendaId ?? null;
  if (userRol !== Rol.OWNER && userRol !== Rol.MANAGER) {
    return Response.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const fichaje = await prisma.fichaje.findUnique({
    where: { id },
    select: {
      tiendaId: true,
      fotoSnapshotEnc: true,
    },
  });
  if (!fichaje) {
    return Response.json({ error: "Fichaje no encontrado" }, { status: 404 });
  }
  if (userRol === Rol.MANAGER && fichaje.tiendaId !== userTiendaId) {
    return Response.json({ error: "No autorizado" }, { status: 403 });
  }
  if (!fichaje.fotoSnapshotEnc) {
    return Response.json({ error: "Sin foto" }, { status: 404 });
  }

  try {
    const bytes = decrypt(new Uint8Array(fichaje.fotoSnapshotEnc as Buffer));
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[/api/fichajes/[id]/foto] decrypt fail:", err);
    return Response.json({ error: "No se pudo descifrar" }, { status: 500 });
  }
});
