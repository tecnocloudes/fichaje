import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = (session.user as any).id as string;
    const rol = (session.user as any).rol as string;
    const { searchParams } = new URL(req.url);
    const soloMias = searchParams.get("soloMias") === "true";

    const where =
      rol === "EMPLEADO" || soloMias
        ? { OR: [{ asignadoAId: userId }, { creadoPorId: userId }] }
        : {};

    const tareas = await prisma.tarea.findMany({
      where,
      include: {
        asignadoA: { select: { id: true, nombre: true, apellidos: true } },
        creadoPor: { select: { id: true, nombre: true, apellidos: true } },
      },
      orderBy: [{ completada: "asc" }, { fechaLimite: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ tareas });
  } catch (error) {
    console.error("GET /api/tareas error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = (session.user as any).id as string;

    const body = await req.json();
    const { titulo, descripcion, prioridad, fechaLimite, asignadoAId } = body;

    if (!titulo) return NextResponse.json({ error: "El título es obligatorio" }, { status: 400 });

    const tarea = await prisma.tarea.create({
      data: {
        titulo,
        descripcion: descripcion || null,
        prioridad: prioridad || "MEDIA",
        fechaLimite: fechaLimite ? new Date(fechaLimite) : null,
        asignadoAId: asignadoAId || null,
        creadoPorId: userId,
      },
      include: {
        asignadoA: { select: { id: true, nombre: true, apellidos: true } },
        creadoPor: { select: { id: true, nombre: true, apellidos: true } },
      },
    });

    return NextResponse.json({ tarea }, { status: 201 });
  } catch (error) {
    console.error("POST /api/tareas error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
