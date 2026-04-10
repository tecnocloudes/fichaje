import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const tareas = await prisma.tareaOnboarding.findMany({
      where: { procesoId: id },
      orderBy: { orden: "asc" },
    });

    return NextResponse.json({ tareas });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const { titulo, descripcion, orden } = await req.json();
    if (!titulo) return NextResponse.json({ error: "Título requerido" }, { status: 400 });

    const tarea = await prisma.tareaOnboarding.create({
      data: { procesoId: id, titulo, descripcion: descripcion || null, orden: orden ?? 0 },
    });

    return NextResponse.json({ tarea }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const { tareaId, completada, titulo, descripcion } = await req.json();
    if (!tareaId) return NextResponse.json({ error: "tareaId requerido" }, { status: 400 });

    const tarea = await prisma.tareaOnboarding.update({
      where: { id: tareaId, procesoId: id },
      data: {
        ...(completada !== undefined && { completada }),
        ...(titulo !== undefined && { titulo }),
        ...(descripcion !== undefined && { descripcion }),
      },
    });

    return NextResponse.json({ tarea });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const tareaId = searchParams.get("tareaId");
    if (!tareaId) return NextResponse.json({ error: "tareaId requerido" }, { status: 400 });

    await prisma.tareaOnboarding.delete({ where: { id: tareaId, procesoId: id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
