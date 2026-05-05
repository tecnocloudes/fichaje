/**
 * POST /api/solicitudes-firma/[id]/firmar
 *
 * Solo el destinatario de la solicitud puede firmarla. Crea un registro
 * `Firma` con hash del documento + IP + UserAgent y marca la solicitud
 * como `firmada`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { hashDocumento } from "@/lib/firmas/hash-documento";

export const POST = withTenant(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;

  const solicitud = await prismaApp.solicitudFirma.findUnique({
    where: { id },
    include: {
      documento: { select: { id: true, nombre: true, url: true } },
      firma: { select: { id: true } },
    },
  });
  if (!solicitud) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }
  if (solicitud.destinatarioId !== user.id) {
    return NextResponse.json(
      { error: "Solo el destinatario puede firmar" },
      { status: 403 },
    );
  }
  if (solicitud.estado !== "pendiente") {
    return NextResponse.json(
      { error: `La solicitud está en estado ${solicitud.estado}` },
      { status: 409 },
    );
  }
  if (solicitud.expiraEn && solicitud.expiraEn < new Date()) {
    await prismaApp.solicitudFirma.update({
      where: { id },
      data: { estado: "expirada" },
    });
    return NextResponse.json({ error: "La solicitud ha expirado" }, { status: 410 });
  }

  // Sello probatorio: hash del nombre + URL en el momento de firmar.
  const documentHash = hashDocumento(
    `${solicitud.documento.id}|${solicitud.documento.nombre}|${solicitud.documento.url ?? ""}`,
  );
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : null;
  const ua = req.headers.get("user-agent");

  const [firma] = await prismaApp.$transaction([
    prismaApp.firma.create({
      data: {
        documentoId: solicitud.documentoId,
        userId: user.id,
        solicitudId: solicitud.id,
        documentHash,
        ip,
        userAgent: ua,
      },
    }),
    prismaApp.solicitudFirma.update({
      where: { id },
      data: { estado: "firmada" },
    }),
  ]);

  return NextResponse.json({ firma }, { status: 201 });
});
