/**
 * POST /api/auth/recuperar-password
 *
 * Inicia el flujo "olvidé mi contraseña". Recibe un email, busca el
 * usuario en el tenant actual y, si existe y está activo, genera un
 * resetToken (TTL 1h) y envía el email con el enlace a /set-password.
 *
 * Respuesta uniforme `{ ok: true }` haya o no usuario, para evitar
 * que un atacante use este endpoint como oráculo de enumeración de
 * cuentas (un 404 explícito daría pistas).
 *
 * Reusa los campos `resetToken` + `resetTokenExpiry` ya existentes
 * en `User`. Reusa la página `/set-password?token=...` (acepta
 * cualquier token vigente, no distingue entre invitación y reset).
 */

import { prismaApp as prisma } from "@/lib/prisma";
import { sendSystemEmail } from "@/lib/email";
import { resetPasswordTemplate } from "@/lib/email-templates";
import { buildResetPasswordUrl } from "@/lib/tenant/urls";
import { currentTenant } from "@/lib/tenant/context";
import { withTenant } from "@/lib/tenant/with-tenant";
import crypto from "crypto";
import type { NextRequest } from "next/server";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

export const POST = withTenant(async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => null) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Email inválido" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, nombre: true, apellidos: true, activo: true },
    });

    // Respuesta uniforme: respondemos 200 OK aunque el usuario no
    // exista o esté inactivo. La UI muestra el mismo mensaje de
    // confirmación siempre — evita user enumeration vía timing/status.
    if (!user || !user.activo) {
      return Response.json({ ok: true });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + TOKEN_TTL_MS);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    const slug = currentTenant().slug;
    const resetUrl = buildResetPasswordUrl(slug, resetToken);
    const config = await prisma.configuracionEmpresa.findFirst({
      select: { nombre: true, appNombre: true, colorPrimario: true, colorSidebar: true, logo: true },
    });
    const empresa = config?.nombre ?? config?.appNombre ?? "empleaIA";
    const html = resetPasswordTemplate({
      nombre: user.nombre,
      apellidos: user.apellidos,
      empresa,
      colorPrimario: config?.colorPrimario ?? "#6366f1",
      colorSidebar: config?.colorSidebar ?? "#1e1b4b",
      logo: config?.logo ?? null,
      resetUrl,
    });

    // sendSystemEmail respeta el `emailActivo` del tenant. Si SMTP no
    // está configurado el email se descarta silenciosamente — la UI
    // sigue mostrando confirmación uniforme (no es trabajo nuestro
    // exponer esa configuración al usuario final).
    await sendSystemEmail(user.email, `Restablece tu contraseña en ${empresa}`, html).catch(
      (err) => {
        console.error("POST /api/auth/recuperar-password sendEmail error:", err);
      },
    );

    return Response.json({ ok: true });
  } catch (error) {
    console.error("POST /api/auth/recuperar-password error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
