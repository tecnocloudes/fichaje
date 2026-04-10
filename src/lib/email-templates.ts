interface BienvenidaParams {
  nombre: string;
  apellidos: string;
  email: string;
  password: string;
  rol: string;
  empresa: string;
  colorPrimario: string;
  colorSidebar: string;
  logo?: string | null;
  appUrl?: string;
}

interface InvitacionParams {
  nombre: string;
  apellidos: string;
  email: string;
  rol: string;
  empresa: string;
  colorPrimario: string;
  colorSidebar: string;
  logo?: string | null;
  setPasswordUrl: string;
}

export function invitacionTemplate(params: InvitacionParams): string {
  const {
    nombre,
    apellidos,
    email,
    rol,
    empresa,
    colorPrimario,
    colorSidebar,
    logo,
    setPasswordUrl,
  } = params;

  const rolLabel = getRolLabel(rol);
  const priRgb = hexToRgb(colorPrimario);

  const logoHtml = logo
    ? `<img src="${logo}" alt="${empresa}" style="max-height:48px;max-width:180px;object-fit:contain;" />`
    : `<div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;background:rgba(255,255,255,0.2);font-size:22px;font-weight:800;color:white;letter-spacing:-1px;">${empresa.charAt(0).toUpperCase()}</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bienvenido a ${empresa}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f5f9;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:${colorSidebar};border-radius:16px 16px 0 0;padding:36px 40px;text-align:center;">
              <div style="margin-bottom:20px;">
                ${logoHtml}
              </div>
              <h1 style="margin:0 0 8px;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">
                ¡Bienvenido/a a ${empresa}!
              </h1>
              <p style="margin:0;color:rgba(255,255,255,0.65);font-size:14px;">
                El equipo de administración ha creado tu cuenta.
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px;">

              <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0f172a;">
                Hola, ${nombre} ${apellidos} 👋
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;">
                Tu cuenta en <strong style="color:#0f172a;">${empresa}</strong> ha sido creada con el rol de
                <strong style="color:#0f172a;">${rolLabel}</strong>. Para activarla, crea tu contraseña haciendo clic en el botón de abajo.
              </p>

              <!-- Info card -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:28px;overflow:hidden;">
                <tr>
                  <td style="background:${colorPrimario};padding:10px 20px;">
                    <p style="margin:0;font-size:11px;font-weight:700;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:1px;">
                      Datos de tu cuenta
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Usuario (email)</p>
                    <p style="margin:0;font-size:15px;font-weight:600;color:#0f172a;font-family:monospace;">${email}</p>
                  </td>
                </tr>
              </table>

              <!-- Expiry notice -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="background:rgba(${priRgb},0.06);border-left:3px solid ${colorPrimario};border-radius:0 8px 8px 0;margin-bottom:32px;">
                <tr>
                  <td style="padding:12px 16px;">
                    <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
                      ⏰ <strong>Este enlace expira en 7 días.</strong> Si no puedes acceder, contacta con tu administrador.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center">
                    <a href="${setPasswordUrl}"
                      style="display:inline-block;background:${colorPrimario};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px;letter-spacing:0.2px;">
                      Crear mi contraseña →
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="background:#ffffff;padding:0 40px;">
              <div style="border-top:1px solid #e2e8f0;"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#ffffff;padding:24px 40px 32px;border-radius:0 0 16px 16px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">
                Este email ha sido enviado automáticamente por <strong>${empresa}</strong>.
              </p>
              <p style="margin:0;font-size:12px;color:#cbd5e1;">
                Si no esperabas este mensaje, puedes ignorarlo.
              </p>
            </td>
          </tr>

          <tr><td style="height:24px;"></td></tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function getRolLabel(rol: string): string {
  switch (rol) {
    case "SUPERADMIN": return "Super Admin";
    case "MANAGER": return "Manager";
    default: return "Empleado";
  }
}

export function bienvenidaTemplate(params: BienvenidaParams): string {
  const {
    nombre,
    apellidos,
    email,
    password,
    rol,
    empresa,
    colorPrimario,
    colorSidebar,
    logo,
    appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000",
  } = params;

  const rolLabel = getRolLabel(rol);
  const priRgb = hexToRgb(colorPrimario);

  const logoHtml = logo
    ? `<img src="${logo}" alt="${empresa}" style="max-height:48px;max-width:180px;object-fit:contain;" />`
    : `<div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;background:rgba(255,255,255,0.2);font-size:22px;font-weight:800;color:white;letter-spacing:-1px;">${empresa.charAt(0).toUpperCase()}</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bienvenido a ${empresa}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f5f9;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

          <!-- ── Header ───────────────────────────────────────────────── -->
          <tr>
            <td style="background:${colorSidebar};border-radius:16px 16px 0 0;padding:36px 40px;text-align:center;">
              <div style="margin-bottom:20px;">
                ${logoHtml}
              </div>
              <h1 style="margin:0 0 8px;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">
                ¡Bienvenido a ${empresa}!
              </h1>
              <p style="margin:0;color:rgba(255,255,255,0.65);font-size:14px;">
                Tu cuenta está lista. Ya puedes empezar.
              </p>
            </td>
          </tr>

          <!-- ── Body ─────────────────────────────────────────────────── -->
          <tr>
            <td style="background:#ffffff;padding:40px;">

              <!-- Greeting -->
              <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0f172a;">
                Hola, ${nombre} ${apellidos} 👋
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;">
                El equipo de administración ha creado tu cuenta con el rol de
                <strong style="color:#0f172a;">${rolLabel}</strong>.
                A continuación encontrarás tus credenciales de acceso.
              </p>

              <!-- Credentials card -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:28px;overflow:hidden;">
                <tr>
                  <td style="background:${colorPrimario};padding:10px 20px;">
                    <p style="margin:0;font-size:11px;font-weight:700;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:1px;">
                      Credenciales de acceso
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td style="padding-bottom:12px;">
                          <p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Usuario (email)</p>
                          <p style="margin:0;font-size:15px;font-weight:600;color:#0f172a;font-family:monospace;">${email}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="border-top:1px solid #e2e8f0;padding-top:12px;">
                          <p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Contraseña temporal</p>
                          <p style="margin:0;font-size:15px;font-weight:700;color:#0f172a;font-family:monospace;letter-spacing:1px;">${password}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Security notice -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="background:rgba(${priRgb},0.06);border-left:3px solid ${colorPrimario};border-radius:0 8px 8px 0;margin-bottom:32px;">
                <tr>
                  <td style="padding:12px 16px;">
                    <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
                      🔒 <strong>Importante:</strong> Por seguridad, te recomendamos cambiar tu contraseña en cuanto accedas por primera vez.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center">
                    <a href="${appUrl}/login"
                      style="display:inline-block;background:${colorPrimario};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px;letter-spacing:0.2px;">
                      Acceder a la plataforma →
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ── Divider ───────────────────────────────────────────────── -->
          <tr>
            <td style="background:#ffffff;padding:0 40px;">
              <div style="border-top:1px solid #e2e8f0;"></div>
            </td>
          </tr>

          <!-- ── Footer ───────────────────────────────────────────────── -->
          <tr>
            <td style="background:#ffffff;padding:24px 40px 32px;border-radius:0 0 16px 16px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">
                Este email ha sido enviado automáticamente por <strong>${empresa}</strong>.
              </p>
              <p style="margin:0;font-size:12px;color:#cbd5e1;">
                Si no esperabas este mensaje, puedes ignorarlo.
              </p>
            </td>
          </tr>

          <!-- ── Bottom spacer ─────────────────────────────────────────── -->
          <tr>
            <td style="height:24px;"></td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}
