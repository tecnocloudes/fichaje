import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    const { searchParams } = new URL(req.url);
    const soloPublicados = searchParams.get("publicados") !== "false";

    const where = rol === "EMPLEADO" || soloPublicados ? { publicado: true } : {};

    const comunicados = await prisma.comunicado.findMany({
      where,
      include: { autor: { select: { nombre: true, apellidos: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ comunicados });
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
    const autorId = (session.user as any).id as string;

    const body = await req.json();
    const { titulo, contenido, publicado } = body;
    if (!titulo || !contenido) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });

    const comunicado = await prisma.comunicado.create({
      data: {
        titulo,
        contenido,
        publicado: publicado ?? false,
        publicadoEn: publicado ? new Date() : null,
        autorId,
      },
      include: { autor: { select: { nombre: true, apellidos: true } } },
    });

    return NextResponse.json({ comunicado }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
