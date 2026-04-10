import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { id } = await params;
    const body = await req.json();

    const proceso = await prisma.procesoOnboarding.update({
      where: { id },
      data: {
        ...(body.tipo !== undefined && { tipo: body.tipo }),
        ...(body.estado !== undefined && { estado: body.estado }),
        ...(body.fechaInicio !== undefined && { fechaInicio: new Date(body.fechaInicio) }),
        ...(body.fechaFin !== undefined && { fechaFin: body.fechaFin ? new Date(body.fechaFin) : null }),
        ...(body.notas !== undefined && { notas: body.notas }),
      },
      include: {
        user: { select: { id: true, nombre: true, apellidos: true, email: true, tienda: { select: { nombre: true } } } },
      },
    });

    return NextResponse.json({ proceso });
  } catch (error) {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { id } = await params;
    await prisma.procesoOnboarding.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
