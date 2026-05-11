import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const updateSchema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  cif: z.string().min(1).max(20).optional(),
  direccion: z.string().max(200).nullable().optional(),
  codigoPostal: z.string().max(10).nullable().optional(),
  ciudad: z.string().max(100).nullable().optional(),
  telefono: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional(),
  activa: z.boolean().optional(),
});

export const PUT = withTenant(withFeature("multi_empresa", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const empresa = await prisma.empresa.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ empresa });
}));

export const DELETE = withTenant(withFeature("multi_empresa", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
  const { id } = await params;
  await prisma.empresa.delete({ where: { id } });
  return NextResponse.json({ success: true });
}));
