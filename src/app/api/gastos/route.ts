import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { runMigrations } from "@/lib/migrate";

const createSchema = z.object({
  concepto: z.string().min(1).max(200),
  importe: z.number().positive().max(99999),
  moneda: z.string().length(3).optional(),
  categoria: z.enum(["dietas", "transporte", "hotel", "material", "varios"]).optional(),
  fecha: z.string().datetime(),
  ticketUrl: z.string().max(500_000).nullable().optional(), // data URL pequeño
  notas: z.string().max(1000).nullable().optional(),
});

export const GET = withTenant(withFeature("control_gastos", async (req: NextRequest) => {
  await runMigrations();
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  const { searchParams } = req.nextUrl;
  const estado = searchParams.get("estado");
  const where = userRol === Rol.OWNER || userRol === Rol.MANAGER ? {} : { userId };
  const gastos = await prisma.gasto.findMany({
    where: { ...where, ...(estado ? { estado } : {}) },
    orderBy: [{ estado: "asc" }, { fecha: "desc" }],
    include: {
      user: { select: { id: true, nombre: true, apellidos: true } },
      revisor: { select: { id: true, nombre: true, apellidos: true } },
    },
  });
  return NextResponse.json({ gastos });
}));

export const POST = withTenant(withFeature("control_gastos", async (req: NextRequest) => {
  await runMigrations();
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  const gasto = await prisma.gasto.create({
    data: {
      userId,
      concepto: parsed.data.concepto,
      importe: parsed.data.importe,
      moneda: parsed.data.moneda ?? "EUR",
      categoria: parsed.data.categoria ?? "varios",
      fecha: new Date(parsed.data.fecha),
      ticketUrl: parsed.data.ticketUrl ?? null,
      notas: parsed.data.notas ?? null,
    },
    include: { user: { select: { id: true, nombre: true, apellidos: true } } },
  });
  return NextResponse.json({ gasto }, { status: 201 });
}));
