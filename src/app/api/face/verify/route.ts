/**
 * POST /api/face/verify
 *
 * El cliente computa un embedding (face-api.js) y lo manda. El backend
 * descifra el template del usuario y calcula similitud cosine. Si
 * supera el umbral, devuelve `match: true` y registra la verificación
 * con éxito; si no, `match: false`.
 *
 * Si se quiere asociar la verificación a un fichaje en curso, el
 * cliente puede pasar `fichajeId` en el body para enlace débil.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { decryptFloat32 } from "@/lib/crypto/aes-gcm";
import { cosineSimilarity, FACE_MATCH_THRESHOLD } from "@/lib/face/similitud";

const schema = z.object({
  embedding: z.array(z.number()).length(128),
  fichajeId: z.string().optional(),
});

export const POST = withTenant(async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const tpl = await prismaApp.faceTemplate.findUnique({
    where: { userId: user.id },
    select: { id: true, embeddingEnc: true },
  });
  if (!tpl) {
    return NextResponse.json(
      { error: "No tienes una plantilla biométrica. Regístrala primero en Face ID → Mi Face ID." },
      { status: 404 },
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Embedding inválido" }, { status: 400 });
  }

  const candidate = new Float32Array(parsed.data.embedding);
  const stored = decryptFloat32(tpl.embeddingEnc);
  const score = cosineSimilarity(stored, candidate);
  const match = score >= FACE_MATCH_THRESHOLD;

  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : null;
  const ua = req.headers.get("user-agent");

  await prismaApp.faceVerificacion.create({
    data: {
      templateId: tpl.id,
      score,
      resultado: match ? "match" : "no_match",
      ip,
      userAgent: ua,
      fichajeId: parsed.data.fichajeId ?? null,
    },
  });

  return NextResponse.json({
    match,
    score,
    threshold: FACE_MATCH_THRESHOLD,
  });
});
