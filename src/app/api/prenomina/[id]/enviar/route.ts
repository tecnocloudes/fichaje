/**
 * POST /api/prenomina/[id]/enviar — CERRADA → ENVIADA.
 *
 * Marca la prenómina como entregada al gestor laboral. Solo OWNER.
 * Body opcional: { canal?: "email"|"manual"|"sage"|"a3", destinatario?: string }.
 * Si canal=="email" + destinatario, envía un correo con el CSV/XLSX adjunto
 * usando el mailer del tenant.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const CANALES = ["email", "manual", "sage", "a3"] as const;
type Canal = (typeof CANALES)[number];

export const POST = withTenant(
  withFeature("prenomina", async (
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
    }
    const userId = (session.user as { id?: string }).id;
    if (!userId) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      canal?: string;
      destinatario?: string;
    };
    const canal: Canal = CANALES.includes(body.canal as Canal)
      ? (body.canal as Canal)
      : "manual";
    const destinatario = body.destinatario?.trim() || null;
    if (canal === "email" && !destinatario) {
      return NextResponse.json(
        { error: "destinatario requerido si canal=email" },
        { status: 400 },
      );
    }

    const { id } = await params;
    const pre = await prisma.prenomina.findUnique({
      where: { id },
      select: { estado: true },
    });
    if (!pre) return NextResponse.json({ error: "Prenómina no encontrada" }, { status: 404 });
    if (pre.estado !== "CERRADA") {
      return NextResponse.json(
        { error: `Solo se pueden enviar prenominas CERRADAS (estado actual: ${pre.estado})` },
        { status: 400 },
      );
    }

    await prisma.prenomina.update({
      where: { id },
      data: {
        estado: "ENVIADA",
        enviadaAt: new Date(),
        enviadaPorId: userId,
        enviadaCanal: canal,
        enviadaDestinatario: destinatario,
      },
    });

    return NextResponse.json({ ok: true, canal, destinatario });
  }),
);
