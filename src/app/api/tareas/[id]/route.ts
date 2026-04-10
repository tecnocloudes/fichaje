import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { id } = await params;
    const body = await req.json();

    const tarea = await prisma.tarea.update({
      where: { id },
      data: {
        ...(body.titulo !== undefined && { titulo: body.titulo }),
        ...(body.descripcion !== undefined && { descripcion: body.descripcion }),
        ...(body.prioridad !== undefined && { prioridad: body.prioridad }),
        ...(body.completada !== undefined && { completada: body.completada }),
        ...(body.fechaLimite !== undefined && { fechaLimite: body.fechaLimite ? new Date(body.fechaLimite) : null }),
        ...(body.asignadoAId !== undefined && { asignadoAId: body.asignadoAId || null }),
      },
      include: {
        asignadoA: { select: { id: true, nombre: true, apellidos: true } },
        creadoPor: { select: { id: true, nombre: true, apellidos: true } },
      },
    });

    return NextResponse.json({ tarea });
  } catch (error) {
    console.error("PUT /api/tareas/[id] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { id } = await params;

    await prisma.tarea.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/tareas/[id] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
