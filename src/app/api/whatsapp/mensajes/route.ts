import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const createSchema = z.object({
  destinatarioTelefono: z.string().min(5).max(40),
  texto: z.string().min(1).max(4096),
});

export const GET = withTenant(withFeature("whatsapp_bot", async () => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER && userRol !== Rol.MANAGER) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const mensajes = await prisma.mensajeWhatsapp.findMany({
    orderBy: { createdAt: "desc" }, take: 200,
  });
  return NextResponse.json({ mensajes });
}));

export const POST = withTenant(withFeature("whatsapp_bot", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER && userRol !== Rol.MANAGER) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  // MVP: solo encolar. El envío real lo hace un worker (no implementado).
  const mensaje = await prisma.mensajeWhatsapp.create({ data: parsed.data });
  return NextResponse.json({ mensaje, info: "Mensaje encolado. El envío real requiere worker externo conectado a WhatsApp Business API." }, { status: 201 });
}));
