/**
 * GET/POST /api/firmas — firma electrónica de documentos.
 * Plan D.2.
 *
 * Stub Fase 7. Integración DocuSign/proveedor real → Fase 9.
 *
 * GET: lista firmas del tenant (filtros documentoId, userId).
 * POST: registra una firma. Body: { documentoId, userId }.
 *   Calcula document_hash = sha256(documento.url ?? documento.id).
 *   Captura ip + user-agent del request.
 *   Devuelve { id, documentHash, firmadoEn }.
 */

import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { createHash } from "node:crypto";

export const GET = withTenant(
  withFeature("firma_electronica", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { searchParams } = req.nextUrl;
    const documentoId = searchParams.get("documentoId");
    const userId = searchParams.get("userId");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (documentoId) where.documentoId = documentoId;
    if (userId) where.userId = userId;
    const firmas = await prismaApp.firma.findMany({
      where,
      orderBy: { firmadoEn: "desc" },
      include: {
        documento: { select: { id: true, nombre: true } },
        user: { select: { id: true, nombre: true, apellidos: true } },
      },
    });
    return NextResponse.json({ firmas });
  }),
);

export const POST = withTenant(
  withFeature("firma_electronica", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const body = (await req.json()) as { documentoId?: string; userId?: string };
    if (!body.documentoId || !body.userId) {
      return NextResponse.json(
        { error: "missing_fields", required: ["documentoId", "userId"] },
        { status: 400 },
      );
    }
    const doc = await prismaApp.documento.findUnique({
      where: { id: body.documentoId },
      select: { id: true, url: true },
    });
    if (!doc) {
      return NextResponse.json({ error: "documento_not_found" }, { status: 404 });
    }
    // Hash determinista para auditoría.
    const documentHash = createHash("sha256")
      .update(doc.url ?? doc.id)
      .digest("hex");
    const fwd = req.headers.get("x-forwarded-for");
    const ip = fwd ? fwd.split(",")[0]!.trim() : null;
    const ua = req.headers.get("user-agent");
    const firma = await prismaApp.firma.create({
      data: {
        documentoId: body.documentoId,
        userId: body.userId,
        documentHash,
        ip,
        userAgent: ua,
      },
    });
    return NextResponse.json({ firma }, { status: 201 });
  }),
);
