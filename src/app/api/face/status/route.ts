/**
 * GET /api/face/status — devuelve si el usuario actual tiene plantilla
 * facial registrada. Lo usa el cliente del fichaje para decidir si
 * ofrecer "Fichar con Face ID" o no.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";

export const GET = withTenant(async () => {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const tpl = await prismaApp.faceTemplate.findUnique({
    where: { userId },
    select: { id: true, createdAt: true },
  });
  return NextResponse.json({
    hasTemplate: !!tpl,
    createdAt: tpl?.createdAt ?? null,
  });
});
