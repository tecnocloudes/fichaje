/**
 * Email al informante de una denuncia cuando cambia su estado.
 * Plantilla minimalista (sin branding del tenant — el informante
 * podría ser anónimo respecto al tenant pero conoce su empresa).
 */

const ESTADO_HUMAN: Record<string, string> = {
  recibida: "recibida",
  acuse_recibido: "ha recibido acuse",
  en_investigacion: "está siendo investigada",
  resuelta: "ha sido resuelta",
  archivada: "ha sido archivada",
};

interface Args {
  asunto: string;
  estadoNuevo: string;
  empresa: string;
  resolucionResumen?: string | null;
}

export function denunciaEstadoTemplate({
  asunto,
  estadoNuevo,
  empresa,
  resolucionResumen,
}: Args): string {
  const accion = ESTADO_HUMAN[estadoNuevo] ?? estadoNuevo;
  const safeAsunto = asunto.replace(/[<>]/g, "");
  const safeEmpresa = empresa.replace(/[<>]/g, "");
  const resolucionBlock = resolucionResumen
    ? `<p style="margin-top:24px;padding:16px;background:#f8fafc;border-left:3px solid #6366f1;border-radius:4px;font-size:14px;color:#334155">
         <strong>Resumen de la resolución:</strong><br/>${resolucionResumen.replace(/[<>]/g, "")}
       </p>`
    : "";

  return `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 16px">Tu denuncia ${accion}</h1>
    <p style="color:#475569;font-size:14px;line-height:1.6">
      Tu denuncia <strong>"${safeAsunto}"</strong> en <strong>${safeEmpresa}</strong> ha cambiado de estado.
    </p>
    <p style="color:#475569;font-size:14px;line-height:1.6">
      Estado actual: <strong style="color:#0f172a">${ESTADO_HUMAN[estadoNuevo] ?? estadoNuevo}</strong>
    </p>
    ${resolucionBlock}
    <p style="margin-top:32px;color:#94a3b8;font-size:12px">
      Email automático del canal de denuncias de ${safeEmpresa}.<br/>
      No respondas a este correo. Si necesitas aportar más información, hazlo desde el panel.
    </p>
  </div>
</body></html>`;
}
