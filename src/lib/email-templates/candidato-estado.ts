/**
 * Email al candidato cuando cambia su estado en el pipeline.
 * Solo se envía para estados visibles al candidato (no "recibido"
 * que es el inicial, ni cambios internos).
 */

const ESTADO_HUMAN: Record<string, { titulo: string; cuerpo: string }> = {
  preseleccionado: {
    titulo: "Has pasado la primera fase",
    cuerpo:
      "Nos has interesado y queremos conocerte mejor. En breve te contactaremos para los siguientes pasos.",
  },
  entrevista: {
    titulo: "Te invitamos a una entrevista",
    cuerpo:
      "Queremos invitarte a una entrevista. Contactaremos contigo por teléfono o email para coordinar.",
  },
  oferta_enviada: {
    titulo: "Tienes una oferta",
    cuerpo:
      "Estamos preparando los detalles de la oferta. La recibirás formalmente en breve.",
  },
  contratado: {
    titulo: "¡Bienvenido/a al equipo!",
    cuerpo:
      "Nos alegra confirmarte que pasas a formar parte del equipo. Pronto recibirás la documentación de incorporación.",
  },
  rechazado: {
    titulo: "Sobre tu candidatura",
    cuerpo:
      "Tras revisar tu perfil, hemos decidido no continuar el proceso esta vez. Te agradecemos sinceramente el interés y te deseamos mucho éxito.",
  },
};

interface Args {
  nombre: string;
  apellidos: string;
  ofertaTitulo: string;
  empresa: string;
  estado: string;
}

export function candidatoEstadoTemplate({
  nombre,
  apellidos,
  ofertaTitulo,
  empresa,
  estado,
}: Args): string | null {
  const data = ESTADO_HUMAN[estado];
  if (!data) return null;
  const safe = (s: string) => s.replace(/[<>]/g, "");

  return `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 8px">${data.titulo}</h1>
    <p style="color:#475569;font-size:14px;line-height:1.6">
      Hola ${safe(nombre)} ${safe(apellidos)},
    </p>
    <p style="color:#475569;font-size:14px;line-height:1.6">
      ${data.cuerpo}
    </p>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin-top:16px">
      Posición: <strong style="color:#0f172a">${safe(ofertaTitulo)}</strong><br/>
      Empresa: <strong style="color:#0f172a">${safe(empresa)}</strong>
    </p>
    <p style="margin-top:32px;color:#94a3b8;font-size:12px">
      Email automático del proceso de selección de ${safe(empresa)}.
    </p>
  </div>
</body></html>`;
}

export function candidatoEstadoSubject(estado: string, ofertaTitulo: string, empresa: string): string | null {
  const data = ESTADO_HUMAN[estado];
  if (!data) return null;
  return `${data.titulo} — ${ofertaTitulo} en ${empresa}`;
}
