/**
 * POST /api/ofertas/publica/[id]/postular
 *
 * Endpoint PÚBLICO para que un candidato externo se postule a una
 * oferta. Sin auth — la oferta tiene que estar en estado `abierta`
 * para aceptar candidaturas.
 *
 * Anti-spam mínimo:
 *   - Rechaza si el email ya tiene candidatura para la misma oferta.
 *   - Estado inicial siempre `recibido`.
 *
 * Para producción real añadir reCAPTCHA o un honeypot — por ahora
 * MVP sin protección.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";

const schema = z.object({
  nombre: z.string().min(2).max(120),
  apellidos: z.string().min(2).max(120),
  email: z.string().email(),
  telefono: z.string().max(40).optional(),
  cvUrl: z.string().url().optional().or(z.literal("")).optional(),
  linkedinUrl: z.string().url().optional().or(z.literal("")).optional(),
  notas: z.string().max(2000).optional(),
});

export const POST = withTenant(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const oferta = await prismaApp.ofertaTrabajo.findUnique({
    where: { id },
    select: { id: true, estado: true, titulo: true },
  });
  if (!oferta) {
    return NextResponse.json({ error: "Oferta no encontrada" }, { status: 404 });
  }
  if (oferta.estado !== "abierta") {
    return NextResponse.json(
      { error: "Esta oferta no acepta candidaturas en este momento" },
      { status: 409 },
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const email = data.email.trim().toLowerCase();

  // Anti-duplicado: email + oferta.
  const existing = await prismaApp.candidato.findFirst({
    where: { ofertaId: id, email },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Ya hemos recibido una candidatura tuya para esta oferta. Te contactaremos si avanzas." },
      { status: 409 },
    );
  }

  await prismaApp.candidato.create({
    data: {
      ofertaId: id,
      nombre: data.nombre,
      apellidos: data.apellidos,
      email,
      telefono: data.telefono,
      cvUrl: data.cvUrl || null,
      linkedinUrl: data.linkedinUrl || null,
      notas: data.notas,
      // creadorId null → vino del portal público.
      creadorId: null,
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
});
