/**
 * Plantilla de email de bienvenida tras provisión exitosa.
 * ADR-003 §2.6.
 *
 * El primer OWNER recibe este email con un link de set-password. El
 * link incluye el token de un solo uso almacenado en el User row.
 */

export type BienvenidaEmailData = {
  ownerEmail: string;
  ownerName: string;
  tenantSlug: string;
  setPasswordUrl: string; // https://<slug>.<root>/set-password?token=...
  appName: string;
};

export function bienvenidaSubject(data: BienvenidaEmailData): string {
  return `Tu cuenta en ${data.appName} está lista`;
}

export function bienvenidaHtml(data: BienvenidaEmailData): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Bienvenida</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #1f2937;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px;">
    <h1 style="color: #6366f1;">Bienvenido a ${data.appName}</h1>
    <p>Hola ${data.ownerName},</p>
    <p>Tu cuenta <strong>${data.tenantSlug}</strong> está lista. Para empezar a usarla, establece tu contraseña haciendo click en el botón:</p>
    <p style="text-align: center; margin: 32px 0;">
      <a href="${data.setPasswordUrl}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
        Establecer contraseña
      </a>
    </p>
    <p style="font-size: 14px; color: #6b7280;">El enlace caduca en 24 horas. Si no funciona, copia esta URL en tu navegador:<br>
      <code>${data.setPasswordUrl}</code>
    </p>
    <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e7eb;">
    <p style="font-size: 13px; color: #9ca3af;">
      Recibes este email porque registraste un tenant en ${data.appName}. Si no fuiste tú, ignora este mensaje.
    </p>
  </div>
</body>
</html>
  `.trim();
}

export function bienvenidaText(data: BienvenidaEmailData): string {
  return `Hola ${data.ownerName},

Tu cuenta ${data.tenantSlug} en ${data.appName} está lista.

Establece tu contraseña aquí:
${data.setPasswordUrl}

El enlace caduca en 24 horas.

Si no fuiste tú quien hizo el registro, ignora este mensaje.
`;
}
