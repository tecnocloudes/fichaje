import { prisma } from "./prisma";
import { sendEmail } from "./email";
import { sendPush } from "./push";

export type EventoNotificacion =
  | "ausencias"
  | "turnos"
  | "tareas"
  | "fichajes"
  | "comunicados";

interface EnviarNotificacionParams {
  userId: string;
  titulo: string;
  mensaje: string;
  tipo?: string;
  enlace?: string;
  evento: EventoNotificacion;
  /** Asunto del email (si omitido usa `titulo`) */
  emailSubject?: string;
  /** HTML del email (si omitido usa un template básico con `mensaje`) */
  emailHtml?: string;
  /** Email del destinatario (si omitido se busca en DB) */
  emailTo?: string;
}

const EVENTO_CAMPO = {
  ausencias: {
    global: "notifAusencias",
    inApp: "inAppAusencias",
    email: "emailAusencias",
    push: "pushAusencias",
  },
  turnos: {
    global: "notifTurnos",
    inApp: "inAppTurnos",
    email: "emailTurnos",
    push: "pushTurnos",
  },
  tareas: {
    global: "notifTareas",
    inApp: "inAppTareas",
    email: "emailTareas",
    push: "pushTareas",
  },
  fichajes: {
    global: "notifFichajes",
    inApp: "inAppFichajes",
    email: "emailFichajes",
    push: "pushFichajes",
  },
  comunicados: {
    global: "notifComunicados",
    inApp: "inAppComunicados",
    email: "emailComunicados",
    push: "pushComunicados",
  },
} as const;

export async function enviarNotificacion(params: EnviarNotificacionParams) {
  const {
    userId,
    titulo,
    mensaje,
    tipo = "info",
    enlace,
    evento,
    emailSubject,
    emailHtml,
    emailTo,
  } = params;

  const campos = EVENTO_CAMPO[evento];

  // Config global
  const config = await prisma.configuracionEmpresa.findFirst();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (config && !(config as any)[campos.global]) return;

  // Preferencias del usuario (upsert con defaults si no existen)
  const prefs = await prisma.preferenciasNotificacion.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  // 1. In-app
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((prefs as any)[campos.inApp]) {
    await prisma.notificacion.create({
      data: { userId, titulo, mensaje, tipo, enlace },
    });
  }

  // 2. Email
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (config?.emailActivo && (prefs as any)[campos.email]) {
    const to =
      emailTo ??
      (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))
        ?.email;
    if (to) {
      const html =
        emailHtml ??
        `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
           <h2 style="color:#6366f1">${titulo}</h2>
           <p>${mensaje}</p>
           ${enlace ? `<a href="${enlace}" style="color:#6366f1">Ver detalle</a>` : ""}
         </div>`;
      await sendEmail(to, emailSubject ?? titulo, html).catch(() => {});
    }
  }

  // 3. Push
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (config?.pushActivo && (prefs as any)[campos.push]) {
    await sendPush(userId, titulo, mensaje, enlace).catch(() => {});
  }
}
