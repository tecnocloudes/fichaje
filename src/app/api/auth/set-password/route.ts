import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, password } = body as { token: string; password: string };

    if (!token || !password || password.length < 6) {
      return Response.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { resetToken: token },
      select: { id: true, resetTokenExpiry: true },
    });

    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return Response.json({ error: "El enlace ha expirado o no es válido" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("POST /api/auth/set-password error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
