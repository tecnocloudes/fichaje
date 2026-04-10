import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    const { searchParams } = new URL(req.url);
    const categoria = searchParams.get("categoria");
    const soloPublicados = searchParams.get("publicados") !== "false";

    const where: Record<string, unknown> = {};
    if (rol === "EMPLEADO" || soloPublicados) where.publicado = true;
    if (categoria) where.categoria = categoria;

    const articulos = await prisma.articulo.findMany({
      where,
      include: { autor: { select: { nombre: true, apellidos: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ articulos });
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
    const { titulo, contenido, categoria, publicado } = body;
    if (!titulo || !contenido) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });

    const articulo = await prisma.articulo.create({
      data: {
        titulo,
        contenido,
        categoria: categoria || "general",
        publicado: publicado ?? false,
        autorId,
      },
      include: { autor: { select: { nombre: true, apellidos: true } } },
    });

    return NextResponse.json({ articulo }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
