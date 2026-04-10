import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { NextRequest } from "next/server";
import { sendEmail } from "@/lib/email";
import { invitacionTemplate } from "@/lib/email-templates";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.SUPERADMIN && userRol !== Rol.MANAGER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const tiendaId = searchParams.get("tiendaId");
    const rol = searchParams.get("rol") as Rol | null;
    const activo = searchParams.get("activo");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (userRol === Rol.SUPERADMIN) {
      if (tiendaId) where.tiendaId = tiendaId;
    } else {
      // MANAGER sees only their tienda
      const userTiendaId = (session.user as any).tiendaId as string | null;
      where.tiendaId = userTiendaId;
    }

    if (rol && Object.values(Rol).includes(rol)) {
      where.rol = rol;
    }

    if (activo !== null) {
      where.activo = activo === "true";
    }

    const empleados = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        nombre: true,
        apellidos: true,
        dni: true,
        telefono: true,
        foto: true,
        rol: true,
        tiendaId: true,
        tienda: { select: { id: true, nombre: true } },
        activo: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
    });

    return Response.json({ empleados });
  } catch (error) {
    console.error("GET /api/empleados error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.SUPERADMIN) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json();
    const {
      email,
      nombre,
      apellidos,
      dni,
      telefono,
      foto,
      rol = Rol.EMPLEADO,
      tiendaId,
    } = body as {
      email: string;
      nombre: string;
      apellidos: string;
      dni?: string;
      telefono?: string;
      foto?: string;
      rol?: Rol;
      tiendaId?: string;
    };

    if (!email || !nombre || !apellidos) {
      return Response.json(
        { error: "Faltan campos obligatorios: email, nombre, apellidos" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return Response.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
    }

    // Generate invite token (valid 7 days)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const empleado = await prisma.user.create({
      data: {
        email,
        nombre,
        apellidos,
        dni: dni || undefined,
        telefono: telefono || undefined,
        foto: foto || undefined,
        rol,
        tiendaId: tiendaId || null,
        resetToken,
        resetTokenExpiry,
      },
      select: {
        id: true,
        email: true,
        nombre: true,
        apellidos: true,
        dni: true,
        telefono: true,
        foto: true,
        rol: true,
        tiendaId: true,
        tienda: { select: { id: true, nombre: true } },
        activo: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Send invite email (fire-and-forget)
    const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    prisma.configuracionEmpresa.findFirst({
      select: {
        nombre: true, appNombre: true, colorPrimario: true,
        colorSidebar: true, logo: true, emailActivo: true,
      },
    }).then((config) => {
      if (!config?.emailActivo) return;
      const empresa = config.nombre ?? config.appNombre ?? "Mi Empresa";
      const html = invitacionTemplate({
        nombre,
        apellidos,
        email,
        rol,
        empresa,
        colorPrimario: config.colorPrimario ?? "#6366f1",
        colorSidebar: config.colorSidebar ?? "#1e1b4b",
        logo: config.logo,
        setPasswordUrl: `${appUrl}/set-password?token=${resetToken}`,
      });
      return sendEmail(email, `Bienvenido/a a ${empresa} — Crea tu contraseña`, html);
    }).catch(() => {});

    return Response.json(empleado, { status: 201 });
  } catch (error) {
    console.error("POST /api/empleados error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
