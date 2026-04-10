import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma/client";
import { sendEmail } from "@/lib/email";

export async function POST() {
  try {
    const session = await auth();
    const user = session?.user as { rol?: string; email?: string } | undefined;
    if (!user || user.rol !== Rol.SUPERADMIN) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const config = await prisma.configuracionEmpresa.findFirst();
    if (!config?.emailActivo || !config?.emailHost) {
      return Response.json({ error: "Email no configurado" }, { status: 400 });
    }

    await sendEmail(
      user.email ?? "",
      "Email de prueba – TelecomFichaje",
      `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#6366f1">Prueba de configuración SMTP</h2>
        <p>La configuración de correo electrónico funciona correctamente.</p>
        <p style="color:#6b7280;font-size:14px">Servidor: ${config.emailHost}:${config.emailPort}</p>
      </div>`
    );

    return Response.json({ ok: true });
  } catch (error) {
    console.error("POST /api/configuracion/test-email error:", error);
    return Response.json({ error: "Error al enviar el email" }, { status: 500 });
  }
}
