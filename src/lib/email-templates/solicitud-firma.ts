/**
 * Email al destinatario cuando se le solicita firmar un documento.
 */

interface Args {
  destinatarioNombre: string;
  solicitanteNombre: string;
  documentoNombre: string;
  empresa: string;
  mensaje?: string | null;
  expiraEn?: Date | null;
  firmarUrl: string;
}

export function solicitudFirmaTemplate({
  destinatarioNombre,
  solicitanteNombre,
  documentoNombre,
  empresa,
  mensaje,
  expiraEn,
  firmarUrl,
}: Args): string {
  const safe = (s: string) => s.replace(/[<>]/g, "");
  const mensajeBlock = mensaje
    ? `<p style="margin:16px 0;padding:12px;background:#f8fafc;border-left:3px solid #6366f1;font-size:14px;font-style:italic;color:#475569">"${safe(mensaje)}"</p>`
    : "";
  const expiraBlock = expiraEn
    ? `<p style="font-size:13px;color:#92400e;margin-top:12px">Plazo: hasta el ${expiraEn.toLocaleDateString("es-ES")}</p>`
    : "";

  return `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 8px">Hola ${safe(destinatarioNombre)},</h1>
    <p style="color:#475569;font-size:14px;line-height:1.6">
      <strong>${safe(solicitanteNombre)}</strong> de <strong>${safe(empresa)}</strong> te ha enviado un documento para firmar:
    </p>
    <p style="font-size:16px;color:#0f172a;font-weight:600;margin:16px 0">${safe(documentoNombre)}</p>
    ${mensajeBlock}
    ${expiraBlock}
    <a href="${firmarUrl}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#6366f1;color:white;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">Revisar y firmar</a>
    <p style="margin-top:32px;color:#94a3b8;font-size:12px">
      Tu firma queda registrada con sello de tiempo, hash SHA-256 del documento y tu IP — válida como prueba.
    </p>
  </div>
</body></html>`;
}
