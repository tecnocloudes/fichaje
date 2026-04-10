import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = (session.user as any).id as string;
    const rol = (session.user as any).rol as string;

    const where =
      rol === "EMPLEADO"
        ? { userId }
        : {};

    const documentos = await prisma.documento.findMany({
      where,
      include: {
        user: { select: { nombre: true, apellidos: true } },
        subidoPor: { select: { nombre: true, apellidos: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ documentos });
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
    const subidoPorId = (session.user as any).id as string;

    const body = await req.json();
    const { nombre, descripcion, url, tipo, userId } = body;
    if (!nombre) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });

    const documento = await prisma.documento.create({
      data: {
        nombre,
        descripcion: descripcion || null,
        url: url || null,
        tipo: tipo || "otro",
        userId: userId || null,
        subidoPorId,
      },
      include: {
        user: { select: { nombre: true, apellidos: true } },
        subidoPor: { select: { nombre: true, apellidos: true } },
      },
    });

    return NextResponse.json({ documento }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
