import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const plantillas = await prisma.plantillaTareaOnboarding.findMany({
      orderBy: [{ tipo: "asc" }, { orden: "asc" }],
    });

    return NextResponse.json({ plantillas });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    if (rol !== "SUPERADMIN") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { tipo, titulo, descripcion, orden } = await req.json();
    if (!tipo || !titulo) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });

    const plantilla = await prisma.plantillaTareaOnboarding.create({
      data: { tipo, titulo, descripcion: descripcion || null, orden: orden ?? 0 },
    });

    return NextResponse.json({ plantilla }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
