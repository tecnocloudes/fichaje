/**
 * GET /api/retribucion?periodo=YYYY-MM
 *   EMPLEADO: sus declaraciones del periodo.
 *   OWNER/MANAGER: todas las declaraciones del periodo (todas las personas).
 *
 * POST /api/retribucion
 *   El empleado registra o actualiza una declaración de su retribución
 *   flexible para un periodo dado. UNIQUE (empleado, periodo, concepto)
 *   garantiza una sola fila por combinación.
 *
 * Tablas internas de ahorro fiscal estimado (España, 2026 — referencia).
 * Feature: `retribucion_flex`.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { runMigrations } from "@/lib/migrate";

const CONCEPTOS = ["tickets_restaurante", "guarderia", "transporte", "seguro_medico"] as const;
type Concepto = (typeof CONCEPTOS)[number];

/** Límites mensuales máximos con exención fiscal (referencia España). */
const LIMITES: Record<Concepto, number> = {
  tickets_restaurante: 11 * 22, // 11 €/día × ~22 días laborables
  guarderia: 1000, // sin tope mensual real; usamos 1000 como referencia mensual
  transporte: 1500 / 12, // 1500 €/año / 12
  seguro_medico: 500 / 12, // 500 €/año / 12
};

/** Tipo marginal IRPF estimado (España, asumimos 30 %). */
const IRPF_ESTIMADO = 0.30;

const createSchema = z.object({
  periodo: z.string().regex(/^\d{4}-\d{2}$/),
  concepto: z.enum(CONCEPTOS),
  importe: z.number().nonnegative().max(99999),
  notas: z.string().max(500).nullable().optional(),
});

function ahorroDe(concepto: Concepto, importe: number): number {
  const cap = Math.min(importe, LIMITES[concepto]);
  return Math.round(cap * IRPF_ESTIMADO * 100) / 100;
}

export const GET = withTenant(withFeature("retribucion_flex", async (req: NextRequest) => {
  await runMigrations();
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  const periodo = req.nextUrl.searchParams.get("periodo") ?? new Date().toISOString().slice(0, 7);
  const where = userRol === Rol.OWNER || userRol === Rol.MANAGER ? { periodo } : { empleadoId: userId, periodo };
  const declaraciones = await prisma.declaracionFlex.findMany({
    where, orderBy: { createdAt: "desc" },
    include: { empleado: { select: { id: true, nombre: true, apellidos: true } } },
  });
  const conAhorro = declaraciones.map((d) => ({
    ...d, importe: Number(d.importe),
    ahorroFiscal: ahorroDe(d.concepto as Concepto, Number(d.importe)),
    limite: LIMITES[d.concepto as Concepto] ?? null,
  }));
  return NextResponse.json({ periodo, declaraciones: conAhorro, limites: LIMITES, irpfEstimado: IRPF_ESTIMADO });
}));

export const POST = withTenant(withFeature("retribucion_flex", async (req: NextRequest) => {
  await runMigrations();
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const decl = await prisma.declaracionFlex.upsert({
    where: { empleado_periodo_concepto_uniq: { empleadoId: userId, periodo: parsed.data.periodo, concepto: parsed.data.concepto } },
    create: { empleadoId: userId, periodo: parsed.data.periodo, concepto: parsed.data.concepto, importe: parsed.data.importe, notas: parsed.data.notas ?? null },
    update: { importe: parsed.data.importe, notas: parsed.data.notas ?? null },
  });
  return NextResponse.json({
    declaracion: { ...decl, importe: Number(decl.importe), ahorroFiscal: ahorroDe(parsed.data.concepto, parsed.data.importe), limite: LIMITES[parsed.data.concepto] },
  }, { status: 201 });
}));
