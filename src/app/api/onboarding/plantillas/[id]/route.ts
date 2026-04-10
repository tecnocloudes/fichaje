import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    if (rol !== "SUPERADMIN") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { id } = await params;
    const body = await req.json();

    const plantilla = await prisma.plantillaTareaOnboarding.update({
      where: { id },
      data: {
        ...(body.titulo !== undefined && { titulo: body.titulo }),
        ...(body.descripcion !== undefined && { descripcion: body.descripcion }),
        ...(body.orden !== undefined && { orden: body.orden }),
        ...(body.activa !== undefined && { activa: body.activa }),
      },
    });

    return NextResponse.json({ plantilla });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    if (rol !== "SUPERADMIN") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { id } = await params;
    await prisma.plantillaTareaOnboarding.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
