import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { runMigrations } from "@/lib/migrate";

const createSchema = z.object({
  nombre: z.string().min(1).max(100),
  descripcion: z.string().max(500).nullable().optional(),
  capacidad: z.number().int().min(1).max(1000).optional(),
  ubicacion: z.string().max(200).nullable().optional(),
});

export const GET = withTenant(withFeature("reserva_espacios", async () => {
  await runMigrations();
  const espacios = await prisma.espacioReservable.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
  });
  return NextResponse.json({ espacios });
}));

export const POST = withTenant(withFeature("reserva_espacios", async (req: NextRequest) => {
  await runMigrations();
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER && userRol !== Rol.MANAGER) return NextResponse.json({ error: "Solo OWNER/MANAGER" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const espacio = await prisma.espacioReservable.create({
    data: {
      nombre: parsed.data.nombre,
      descripcion: parsed.data.descripcion ?? null,
      capacidad: parsed.data.capacidad ?? 1,
      ubicacion: parsed.data.ubicacion ?? null,
    },
  });
  return NextResponse.json({ espacio }, { status: 201 });
}));
