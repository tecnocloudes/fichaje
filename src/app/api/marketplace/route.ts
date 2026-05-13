import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const installSchema = z.object({
  slug: z.string().min(1),
  configuracion: z.record(z.string(), z.unknown()),
});

export const GET = withTenant(withFeature("marketplace", async () => {
  const integraciones = await prisma.integracion.findMany({
    orderBy: { nombre: "asc" },
    include: { instalaciones: { select: { id: true, activa: true, configuracion: true, updatedAt: true } } },
  });
  return NextResponse.json({
    integraciones: integraciones.map((i) => ({
      id: i.id, slug: i.slug, nombre: i.nombre, descripcion: i.descripcion,
      categoria: i.categoria, logoUrl: i.logoUrl,
      instalada: i.instalaciones[0]?.activa ?? false,
      instalacionId: i.instalaciones[0]?.id ?? null,
    })),
  });
}));

export const POST = withTenant(withFeature("marketplace", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = installSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const integ = await prisma.integracion.findUnique({ where: { slug: parsed.data.slug }, select: { id: true } });
  if (!integ) return NextResponse.json({ error: "Integración no existe" }, { status: 404 });

  const inst = await prisma.integracionInstalada.upsert({
    where: { integracionId: integ.id },
    create: {
      integracionId: integ.id,
      configuracion: parsed.data.configuracion as Record<string, never>,
      activa: true,
      activadaPorId: userId,
    },
    update: { configuracion: parsed.data.configuracion as Record<string, never>, activa: true },
  });
  return NextResponse.json({ instalacion: inst }, { status: 201 });
}));

export const DELETE = withTenant(withFeature("marketplace", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "Falta slug" }, { status: 400 });
  const integ = await prisma.integracion.findUnique({ where: { slug }, select: { id: true } });
  if (!integ) return NextResponse.json({ error: "No existe" }, { status: 404 });
  await prisma.integracionInstalada.deleteMany({ where: { integracionId: integ.id } });
  return NextResponse.json({ success: true });
}));
