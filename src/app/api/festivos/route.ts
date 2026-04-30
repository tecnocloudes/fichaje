import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
export const GET = withTenant(async () => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const festivos = await prisma.festivo.findMany({
      orderBy: { fecha: "asc" },
    });

    return NextResponse.json({ festivos });
  } catch (error) {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});

export const POST = withTenant(async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    if (rol !== "OWNER") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const body = await req.json();
    const { nombre, fecha, ambito } = body;
    if (!nombre || !fecha) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });

    const festivo = await prisma.festivo.create({
      data: { nombre, fecha: new Date(fecha), ambito: ambito || "nacional" },
    });

    return NextResponse.json({ festivo }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});

export const DELETE = withTenant(async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    if (rol !== "OWNER") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 });

    await prisma.festivo.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});
