/**
 * POST /api/prenomina/enviar?periodo=YYYY-MM — bulk CERRADA → ENVIADA
 * para todas las prenominas del periodo. Solo OWNER.
 *
 * Body opcional: { canal?: "manual"|"sage"|"a3" (no email — el bulk
 * por email se gestiona desde /api/prenomina/exportar + mailer aparte),
 * destinatario?: string }.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const CANALES_BULK = ["manual", "sage", "a3"] as const;
type CanalBulk = (typeof CANALES_BULK)[number];

export const POST = withTenant(
  withFeature("prenomina", async (req: Request) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
    }
    const userId = (session.user as { id?: string }).id;
    if (!userId) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const periodo = searchParams.get("periodo");
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
      return NextResponse.json(
        { error: "periodo_invalid", reason: "formato YYYY-MM requerido" },
        { status: 400 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      canal?: string;
      destinatario?: string;
    };
    const canal: CanalBulk = CANALES_BULK.includes(body.canal as CanalBulk)
      ? (body.canal as CanalBulk)
      : "manual";
    const destinatario = body.destinatario?.trim() || null;

    const result = await prisma.prenomina.updateMany({
      where: { periodo, estado: "CERRADA" },
      data: {
        estado: "ENVIADA",
        enviadaAt: new Date(),
        enviadaPorId: userId,
        enviadaCanal: canal,
        enviadaDestinatario: destinatario,
      },
    });

    return NextResponse.json({ ok: true, enviadas: result.count, canal });
  }),
);
