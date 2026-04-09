import { prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";

export async function GET() {
  try {
    const count = await prisma.user.count();
    return Response.json({ needsSetup: count === 0 });
  } catch (error) {
    console.error("GET /api/setup error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Only allow if no users exist
    const count = await prisma.user.count();
    if (count > 0) {
      return Response.json({ error: "El sistema ya está configurado" }, { status: 409 });
    }

    const body = await request.json();
    const { nombre, apellidos, email, password, tienda } = body as {
      nombre: string;
      apellidos: string;
      email: string;
      password: string;
      tienda?: { nombre: string; direccion: string; ciudad: string };
    };

    if (!nombre || !apellidos || !email || !password) {
      return Response.json(
        { error: "Faltan campos obligatorios: nombre, apellidos, email, password" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return Response.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Create first store if provided
    let tiendaId: string | null = null;
    if (tienda?.nombre && tienda?.direccion && tienda?.ciudad) {
      const nuevaTienda = await prisma.tienda.create({
        data: {
          nombre: tienda.nombre,
          direccion: tienda.direccion,
          ciudad: tienda.ciudad,
        },
      });
      tiendaId = nuevaTienda.id;
    }

    // Create superadmin
    const admin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        nombre,
        apellidos,
        rol: Rol.SUPERADMIN,
        tiendaId,
        activo: true,
      },
    });

    return Response.json({ success: true, userId: admin.id }, { status: 201 });
  } catch (error) {
    console.error("POST /api/setup error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
