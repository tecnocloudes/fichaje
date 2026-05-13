/**
 * Notificaciones de ausencias por email.
 *
 *   notifyAusenciaCreada   → managers de la sede + OWNERs (cuando un
 *                           empleado solicita).
 *   notifyAusenciaResuelta → empleado que pidió (cuando se aprueba o
 *                           rechaza).
 *
 * Respeta `ConfiguracionEmpresa.notifAusencias`: si el OWNER lo apaga,
 * no se manda ningún correo. Best-effort: errores se loggean, no
 * propagan, no rompen la transacción.
 */

import { prismaApp as prisma } from "@/lib/prisma";
import { sendSystemEmail } from "@/lib/email";
import { Rol, EstadoAusencia } from "@/generated/prisma-tenant/client";
import {
  ausenciaCreadaTemplate,
  ausenciaResueltaTemplate,
} from "@/lib/email-templates";
import { notifySlackIfInstalled } from "@/lib/marketplace/slack";

interface AusenciaCtx {
  id: string;
  user: { id: string; nombre: string; apellidos: string; email: string; tiendaId?: string | null };
  tipoAusencia: { nombre: string };
  fechaInicio: Date;
  fechaFin: Date;
  dias: number;
  motivo: string | null;
  estado: EstadoAusencia;
  comentarioAdmin?: string | null;
}

interface BrandingCtx {
  enabled: boolean;
  empresa: string;
  colorPrimario: string;
  colorSidebar: string;
  logo: string | null;
}

async function getBranding(): Promise<BrandingCtx> {
  try {
    const cfg = await prisma.configuracionEmpresa.findUnique({
      where: { id: "singleton" },
      select: {
        notifAusencias: true,
        nombre: true,
        appNombre: true,
        colorPrimario: true,
        colorSidebar: true,
        logo: true,
      },
    });
    return {
      enabled: cfg?.notifAusencias !== false,
      empresa: cfg?.nombre ?? cfg?.appNombre ?? "empleaIA",
      colorPrimario: cfg?.colorPrimario ?? "#6366f1",
      colorSidebar: cfg?.colorSidebar ?? "#1e1b4b",
      logo: cfg?.logo ?? null,
    };
  } catch {
    return {
      enabled: true,
      empresa: "empleaIA",
      colorPrimario: "#6366f1",
      colorSidebar: "#1e1b4b",
      logo: null,
    };
  }
}

export async function notifyAusenciaCreada(a: AusenciaCtx): Promise<void> {
  try {
    const b = await getBranding();
    if (!b.enabled) return;

    // Destinatarios: managers de la sede del solicitante + todos los OWNER.
    const tiendaId = a.user.tiendaId ?? null;
    const managerWhere = tiendaId
      ? { rol: Rol.MANAGER, activo: true, tiendaId }
      : { rol: Rol.MANAGER, activo: true };
    const recipientes = await prisma.user.findMany({
      where: {
        OR: [{ rol: Rol.OWNER, activo: true }, managerWhere],
      },
      select: { email: true, id: true, nombre: true },
    });

    const empleadoNombre = `${a.user.nombre} ${a.user.apellidos}`.trim();
    const subject = `Nueva solicitud de ausencia — ${empleadoNombre}`;

    await Promise.allSettled(
      recipientes
        .filter((r) => r.id !== a.user.id && r.email)
        .map((r) =>
          sendSystemEmail(
            r.email,
            subject,
            ausenciaCreadaTemplate({
              destinatarioNombre: r.nombre || "equipo",
              empleadoNombre,
              tipo: a.tipoAusencia.nombre,
              fechaInicio: a.fechaInicio,
              fechaFin: a.fechaFin,
              dias: a.dias,
              motivo: a.motivo,
              empresa: b.empresa,
              colorPrimario: b.colorPrimario,
              colorSidebar: b.colorSidebar,
              logo: b.logo,
            }),
          ),
        ),
    );

    // Marketplace: si Slack está instalado, manda también un ping al canal.
    const fechaIni = new Intl.DateTimeFormat("es-ES").format(a.fechaInicio);
    const fechaFin = new Intl.DateTimeFormat("es-ES").format(a.fechaFin);
    const slackText =
      `:palm_tree: *Nueva solicitud de ausencia* — ${empleadoNombre}\n` +
      `> Tipo: ${a.tipoAusencia.nombre}\n` +
      `> Fechas: ${fechaIni} → ${fechaFin} (${a.dias} días)` +
      (a.motivo ? `\n> Motivo: ${a.motivo}` : "");
    await notifySlackIfInstalled(slackText);
  } catch (err) {
    console.error("[notifyAusenciaCreada]", err);
  }
}

export async function notifyAusenciaResuelta(a: AusenciaCtx): Promise<void> {
  try {
    const b = await getBranding();
    if (!b.enabled) return;
    if (a.estado !== EstadoAusencia.APROBADA && a.estado !== EstadoAusencia.RECHAZADA) return;
    if (!a.user.email) return;

    const aprobada = a.estado === EstadoAusencia.APROBADA;
    const subject = aprobada
      ? `Tu solicitud de ausencia ha sido aprobada`
      : `Tu solicitud de ausencia ha sido rechazada`;

    await sendSystemEmail(
      a.user.email,
      subject,
      ausenciaResueltaTemplate({
        destinatarioNombre: a.user.nombre,
        empleadoNombre: `${a.user.nombre} ${a.user.apellidos}`.trim(),
        tipo: a.tipoAusencia.nombre,
        fechaInicio: a.fechaInicio,
        fechaFin: a.fechaFin,
        dias: a.dias,
        motivo: a.motivo,
        comentarioAdmin: a.comentarioAdmin ?? null,
        estado: aprobada ? "APROBADA" : "RECHAZADA",
        empresa: b.empresa,
        colorPrimario: b.colorPrimario,
        colorSidebar: b.colorSidebar,
        logo: b.logo,
      }),
    );
  } catch (err) {
    console.error("[notifyAusenciaResuelta]", err);
  }
}
