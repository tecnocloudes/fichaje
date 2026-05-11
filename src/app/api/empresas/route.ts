import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { runMigrations } from "@/lib/migrate";

const createSchema = z.object({
  nombre: z.string().min(1).max(200),
  cif: z.string().min(1).max(20),
  direccion: z.string().max(200).nullable().optional(),
  codigoPostal: z.string().max(10).nullable().optional(),
  ciudad: z.string().max(100).nullable().optional(),
  pais: z.string().max(100).nullable().optional(),
  telefono: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional(),
});

export const GET = withTenant(withFeature("multi_empresa", async () => {
  await runMigrations();
  const empresas = await prisma.empresa.findMany({
    orderBy: { nombre: "asc" },
    include: { _count: { select: { usuarios: true } } },
  });
  return NextResponse.json({ empresas });
}));

export const POST = withTenant(withFeature("multi_empresa", async (req: NextRequest) => {
  await runMigrations();
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const empresa = await prisma.empresa.create({ data: parsed.data });
    return NextResponse.json({ empresa }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && /unique/i.test(e.message)) {
      return NextResponse.json({ error: "Ya existe una empresa con ese CIF" }, { status: 409 });
    }
    throw e;
  }
}));
