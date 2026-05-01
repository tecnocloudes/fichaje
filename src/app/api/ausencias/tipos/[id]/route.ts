/**
 * PUT/DELETE /api/ausencias/tipos/[id]
 * Plan Fase 6 §3.3.
 *
 * Edita y desactiva tipos de ausencia. DELETE es soft-delete
 * (activo=false) para preservar la integridad referencial con
 * Ausencia.tipoAusenciaId.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const PUT = withTenant(
  withFeature("ausencias_aprobacion", async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const { id } = await params;
    const body = (await request.json()) as Partial<{
      nombre: string;
      color: string;
      icono: string;
      pagada: boolean;
      requiereAprobacion: boolean;
      diasMaximos: number | null;
      activo: boolean;
    }>;
    const data: Record<string, unknown> = {};
    for (const k of [
      "nombre",
      "color",
      "icono",
      "pagada",
      "requiereAprobacion",
      "diasMaximos",
      "activo",
    ] as const) {
      if (k in body) data[k] = body[k];
    }
    try {
      const tipo = await prisma.tipoAusencia.update({ where: { id }, data });
      return NextResponse.json(tipo);
    } catch {
      return NextResponse.json(
        { error: "tipo_ausencia_no_existe" },
        { status: 404 },
      );
    }
  }),
);

export const DELETE = withTenant(
  withFeature("ausencias_aprobacion", async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const { id } = await params;
    // Soft-delete: marca activo=false. Preserva integridad con
    // Ausencia.tipoAusenciaId que puede referenciar el tipo.
    try {
      await prisma.tipoAusencia.update({
        where: { id },
        data: { activo: false },
      });
      return NextResponse.json({ success: true });
    } catch {
      return NextResponse.json(
        { error: "tipo_ausencia_no_existe" },
        { status: 404 },
      );
    }
  }),
);
