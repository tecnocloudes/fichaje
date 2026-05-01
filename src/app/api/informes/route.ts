/**
 * GET /api/informes — devuelve JSON del informe solicitado.
 *
 * Thin wrapper sobre `getInformeData()` (src/lib/informes/queries.ts).
 * Toda la lógica de queries Prisma vive en el módulo compartido para
 * poder ser invocada también por /api/informes/exportar SIN fetch
 * interno entre rutas Next (FIX 3 cierre Fase 5).
 */

import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import type { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import {
  getInformeData,
  type InformeTipo,
} from "@/lib/informes/queries";

export const GET = withTenant(async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { searchParams } = request.nextUrl;
    const result = await getInformeData({
      tipo: (searchParams.get("tipo") as InformeTipo) ?? "fichajes",
      fechaInicio: searchParams.get("fechaInicio"),
      fechaFin: searchParams.get("fechaFin"),
      tiendaId: searchParams.get("tiendaId"),
      userId: searchParams.get("userId"),
      fecha: searchParams.get("fecha"),
      userRol: (session.user as { rol: Rol }).rol,
      userTiendaId:
        (session.user as { tiendaId: string | null }).tiendaId ?? null,
      sessionUserId: session.user.id!,
      prisma: prismaApp,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data);
  } catch (error) {
    console.error("GET /api/informes error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
});
