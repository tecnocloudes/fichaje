import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    const userId = (session.user as any).id as string;

    const { searchParams } = new URL(req.url);
    const filterUserId = searchParams.get("userId");

    // Empleado solo ve sus propias horas
    const whereUserId = rol === "EMPLEADO" ? userId : (filterUserId || undefined);

    const [entradas, empleados] = await Promise.all([
      prisma.bolsaHoras.findMany({
        where: whereUserId ? { userId: whereUserId } : undefined,
        include: {
          user: { select: { id: true, nombre: true, apellidos: true } },
          aprobadoPor: { select: { id: true, nombre: true, apellidos: true } },
        },
        orderBy: { fecha: "desc" },
      }),
      rol !== "EMPLEADO"
        ? prisma.user.findMany({
            where: { activo: true },
            select: { id: true, nombre: true, apellidos: true },
            orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
          })
        : Promise.resolve([]),
    ]);

    // Calcular saldos por empleado
    const saldoMap: Record<string, number> = {};
    for (const e of entradas) {
      if (!saldoMap[e.userId]) saldoMap[e.userId] = 0;
      saldoMap[e.userId] += e.tipo === "ACUMULACION" ? e.horas : -e.horas;
    }

    return NextResponse.json({ entradas, empleados, saldoMap });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    const sessionUserId = (session.user as any).id as string;
    if (rol === "EMPLEADO") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { userId, tipo, horas, concepto, fecha } = await req.json();
    if (!userId || !tipo || !horas || !concepto || !fecha) {
      return NextResponse.json({ error: "Faltan campos obligatorios" }, { status: 400 });
    }
    if (!["ACUMULACION", "CONSUMO"].includes(tipo)) {
      return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
    }

    const entrada = await prisma.bolsaHoras.create({
      data: {
        userId,
        tipo,
        horas: Math.abs(Number(horas)),
        concepto,
        fecha: new Date(fecha),
        aprobadoPorId: sessionUserId,
      },
      include: {
        user: { select: { id: true, nombre: true, apellidos: true } },
        aprobadoPor: { select: { id: true, nombre: true, apellidos: true } },
      },
    });

    return NextResponse.json({ entrada }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
