import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { sendEmail } from "@/lib/email";

import { withTenant } from "@/lib/tenant/with-tenant";
export const POST = withTenant(async () => {
  try {
    const session = await auth();
    const user = session?.user as { rol?: string; email?: string } | undefined;
    if (!user || user.rol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const config = await prisma.configuracionEmpresa.findFirst();
    if (!config?.emailActivo || !config?.emailHost) {
      return Response.json({ error: "Email no configurado" }, { status: 400 });
    }

    await sendEmail(
      user.email ?? "",
      "Email de prueba – empleaIA",
      `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#5B5FE9">Prueba de configuración SMTP</h2>
        <p>La configuración de correo electrónico funciona correctamente.</p>
        <p style="color:#475569;font-size:14px">Servidor: ${config.emailHost}:${config.emailPort}</p>
      </div>`
    );

    return Response.json({ ok: true });
  } catch (error: any) {
    console.error("POST /api/configuracion/test-email error:", error);
    const message = error?.message ?? "Error desconocido";
    const code = error?.code ?? null;
    return Response.json({ error: message, code }, { status: 500 });
  }
});
