/**
 * POST /api/prenomina/[id]/reabrir — CERRADA → BORRADOR.
 * Solo OWNER. Permite recalcular o ajustar conceptos.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const POST = withTenant(
  withFeature("prenomina", async (
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo OWNER puede reabrir" }, { status: 403 });
    }

    const { id } = await params;
    const pre = await prisma.prenomina.findUnique({ where: { id }, select: { estado: true } });
    if (!pre) return NextResponse.json({ error: "Prenómina no encontrada" }, { status: 404 });
    if (pre.estado === "BORRADOR") {
      return NextResponse.json({ ok: true });
    }

    await prisma.prenomina.update({
      where: { id },
      data: {
        estado: "BORRADOR",
        cerradaAt: null,
        cerradaPorId: null,
        enviadaAt: null,
      },
    });

    return NextResponse.json({ ok: true });
  }),
);
