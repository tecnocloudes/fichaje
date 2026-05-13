/**
 * POST /api/retribucion/emitir?periodo=YYYY-MM
 *
 * Empuja las declaraciones de retribución flexible del periodo a
 * Cobee (si la integración está instalada con apiKey) o devuelve un
 * report en modo simulado. Solo OWNER. Feature `retribucion_flex`.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { emitirTicketsCobee, type CobeeTicket } from "@/lib/marketplace/cobee";

export const POST = withTenant(
  withFeature("retribucion_flex", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
    }
    const periodo = req.nextUrl.searchParams.get("periodo");
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
      return NextResponse.json(
        { error: "periodo_invalid", reason: "formato YYYY-MM" },
        { status: 400 },
      );
    }

    const declaraciones = await prisma.declaracionFlex.findMany({
      where: { periodo },
      include: {
        empleado: {
          select: { id: true, email: true, dni: true, nombre: true, apellidos: true },
        },
      },
    });
    if (declaraciones.length === 0) {
      return NextResponse.json(
        { error: "No hay declaraciones para el periodo" },
        { status: 404 },
      );
    }

    const tickets: CobeeTicket[] = declaraciones
      .filter((d) => Number(d.importe) > 0)
      .map((d) => ({
        empleadoId: d.empleadoId,
        empleadoEmail: d.empleado.email,
        empleadoDni: d.empleado.dni,
        concepto: d.concepto,
        importe: Number(d.importe),
        periodo: d.periodo,
      }));

    const result = await emitirTicketsCobee(tickets);
    return NextResponse.json({ periodo, ...result });
  }),
);
