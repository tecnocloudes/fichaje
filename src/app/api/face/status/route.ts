/**
 * GET /api/face/status — devuelve si el usuario actual tiene plantilla
 * facial registrada. Lo usa el cliente del fichaje para decidir si
 * ofrecer "Fichar con Face ID" o no.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { hasFeature } from "@/lib/tenant/features";

export const GET = withTenant(async () => {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  // Si la feature no está en el plan, ocultamos la capacidad — el UI no
  // ofrece Face ID en absoluto. No bloqueamos con 402 porque este endpoint
  // se llama en la pantalla de fichaje y queremos que cargue sin error.
  if (!hasFeature("face_id")) {
    return NextResponse.json({ hasTemplate: false, createdAt: null, featureEnabled: false });
  }
  const tpl = await prismaApp.faceTemplate.findUnique({
    where: { userId },
    select: { id: true, createdAt: true },
  });
  return NextResponse.json({
    hasTemplate: !!tpl,
    createdAt: tpl?.createdAt ?? null,
    featureEnabled: true,
  });
});
