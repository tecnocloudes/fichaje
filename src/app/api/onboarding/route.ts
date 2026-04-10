import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const procesos = await prisma.procesoOnboarding.findMany({
      include: {
        user: { select: { id: true, nombre: true, apellidos: true, email: true, tienda: { select: { nombre: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ procesos });
  } catch (error) {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    if (rol === "EMPLEADO") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const body = await req.json();
    const { userId, tipo, estado, fechaInicio, fechaFin, notas } = body;
    if (!userId || !fechaInicio) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });

    const proceso = await prisma.procesoOnboarding.create({
      data: {
        userId,
        tipo: tipo || "ONBOARDING",
        estado: estado || "PENDIENTE",
        fechaInicio: new Date(fechaInicio),
        fechaFin: fechaFin ? new Date(fechaFin) : null,
        notas: notas || null,
      },
      include: {
        user: { select: { id: true, nombre: true, apellidos: true, email: true, tienda: { select: { nombre: true } } } },
      },
    });

    return NextResponse.json({ proceso }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
