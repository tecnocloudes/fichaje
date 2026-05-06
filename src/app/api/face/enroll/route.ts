/**
 * POST /api/face/enroll
 *
 * Registra el embedding facial del usuario actual. El cliente computa
 * el embedding (face-api.js en navegador) y lo manda como array de
 * 128 floats. El backend solo cifra y persiste — nunca recibe foto.
 *
 * Solo permitido si el usuario NO tiene ya un template (1:1 con User).
 * Para resetear, el admin usa DELETE /api/face/template/[userId].
 *
 * Requiere consentimiento GDPR explícito (`consentimiento: true` en body).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { encryptFloat32 } from "@/lib/crypto/aes-gcm";

const schema = z.object({
  embedding: z.array(z.number()).length(128),
  consentimiento: z.literal(true),
});

export const POST = withTenant(async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // ¿Ya tiene template?
  const existing = await prismaApp.faceTemplate.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Ya tienes una plantilla registrada. Pide a un admin que la elimine para registrar otra." },
      { status: 409 },
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Embedding inválido o consentimiento no aceptado" },
      { status: 400 },
    );
  }

  const float = new Float32Array(parsed.data.embedding);
  const enc = encryptFloat32(float);
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : null;
  const ua = req.headers.get("user-agent");

  const tpl = await prismaApp.faceTemplate.create({
    data: {
      userId: user.id,
      embeddingEnc: enc,
      consentimientoIp: ip,
      consentimientoUa: ua,
    },
    select: { id: true, createdAt: true },
  });

  return NextResponse.json({ template: tpl }, { status: 201 });
});
