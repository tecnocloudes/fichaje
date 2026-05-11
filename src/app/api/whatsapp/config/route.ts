import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { runMigrations } from "@/lib/migrate";
import { encryptString } from "@/lib/crypto/aes-gcm";

const updateSchema = z.object({
  phoneNumberId: z.string().max(100).nullable().optional(),
  token: z.string().min(1).max(2000).optional(),
  numeroEmpresa: z.string().max(40).nullable().optional(),
  activo: z.boolean().optional(),
});

export const GET = withTenant(withFeature("whatsapp_bot", async () => {
  await runMigrations();
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
  const cfg = await prisma.whatsappConfig.findUnique({
    where: { id: "singleton" },
    select: { id: true, phoneNumberId: true, numeroEmpresa: true, activo: true, updatedAt: true, tokenEnc: true },
  });
  return NextResponse.json({
    config: cfg
      ? { ...cfg, tokenConfigurado: !!cfg.tokenEnc, tokenEnc: undefined }
      : null,
  });
}));

export const PUT = withTenant(withFeature("whatsapp_bot", async (req: NextRequest) => {
  await runMigrations();
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.phoneNumberId !== undefined) data.phoneNumberId = parsed.data.phoneNumberId;
  if (parsed.data.numeroEmpresa !== undefined) data.numeroEmpresa = parsed.data.numeroEmpresa;
  if (parsed.data.activo !== undefined) data.activo = parsed.data.activo;
  if (parsed.data.token) data.tokenEnc = Buffer.from(encryptString(parsed.data.token));

  const cfg = await prisma.whatsappConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: data,
    select: { id: true, phoneNumberId: true, numeroEmpresa: true, activo: true, updatedAt: true, tokenEnc: true },
  });
  return NextResponse.json({
    config: { ...cfg, tokenConfigurado: !!cfg.tokenEnc, tokenEnc: undefined },
  });
}));
