import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { sendSystemEmail } from "@/lib/email";
import { invitacionTemplate } from "@/lib/email-templates";
import crypto from "crypto";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { currentTenant } from "@/lib/tenant/context";
import { buildSetPasswordUrl } from "@/lib/tenant/urls";
export const POST = withTenant(async (_request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) return Response.json({ error: "No autorizado" }, { status: 403 });

    const { id } = await params;
    const empleado = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, nombre: true, apellidos: true, rol: true, password: true },
    });

    if (!empleado) return Response.json({ error: "Empleado no encontrado" }, { status: 404 });
    if (empleado.password) return Response.json({ error: "El empleado ya tiene contraseña" }, { status: 400 });

    // Generar nuevo token (resetea el anterior)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id },
      data: { resetToken, resetTokenExpiry },
    });

    // Email de invitación. NO depende de `emailActivo` — sin este
    // mail el empleado no puede entrar nunca.
    const setPasswordUrl = buildSetPasswordUrl(currentTenant().slug, resetToken);
    const config = await prisma.configuracionEmpresa.findFirst({
      select: { nombre: true, appNombre: true, colorPrimario: true, colorSidebar: true, logo: true },
    });
    const empresa = config?.nombre ?? config?.appNombre ?? "Mi Empresa";
    const html = invitacionTemplate({
      nombre: empleado.nombre,
      apellidos: empleado.apellidos,
      email: empleado.email,
      rol: empleado.rol,
      empresa,
      colorPrimario: config?.colorPrimario ?? "#6366f1",
      colorSidebar: config?.colorSidebar ?? "#1e1b4b",
      logo: config?.logo ?? null,
      setPasswordUrl,
    });
    await sendSystemEmail(empleado.email, `Invitación a ${empresa} — Crea tu contraseña`, html);

    return Response.json({ success: true });
  } catch (error) {
    console.error("POST /api/empleados/[id]/reenviar-invitacion error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
