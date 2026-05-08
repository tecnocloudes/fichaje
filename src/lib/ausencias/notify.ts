/**
 * Notificaciones de ausencias por email.
 *
 *   notifyAusenciaCreada  → managers de la sede + OWNERs (cuando un
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

function fmt(d: Date): string {
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

async function getEnabled(): Promise<{ enabled: boolean; empresa: string }> {
  try {
    const cfg = await prisma.configuracionEmpresa.findUnique({
      where: { id: "singleton" },
      select: { notifAusencias: true, nombre: true, appNombre: true },
    });
    return {
      enabled: cfg?.notifAusencias !== false,
      empresa: cfg?.nombre ?? cfg?.appNombre ?? "empleaIA",
    };
  } catch {
    return { enabled: true, empresa: "empleaIA" };
  }
}

function shellHtml(empresa: string, body: string): string {
  return `
<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
    <p style="margin:0 0 18px;font-weight:600;color:#1e1b4b">${empresa}</p>
    ${body}
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">Email automático — no respondas a este mensaje.</p>
  </div>
</body></html>`;
}

export async function notifyAusenciaCreada(a: AusenciaCtx): Promise<void> {
  try {
    const { enabled, empresa } = await getEnabled();
    if (!enabled) return;

    // Destinatarios: managers de la sede del solicitante + todos los OWNER.
    const tiendaId = a.user.tiendaId ?? null;
    const managerWhere = tiendaId
      ? { rol: Rol.MANAGER, activo: true, tiendaId }
      : { rol: Rol.MANAGER, activo: true };
    const recipientes = await prisma.user.findMany({
      where: {
        OR: [{ rol: Rol.OWNER, activo: true }, managerWhere],
      },
      select: { email: true, id: true },
    });

    const empleadoNombre = `${a.user.nombre} ${a.user.apellidos}`.trim();
    const subject = `Nueva solicitud de ausencia — ${empleadoNombre}`;
    const html = shellHtml(
      empresa,
      `<h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">Nueva solicitud de ausencia</h2>
       <p style="margin:0 0 12px;color:#334155">
         <strong>${empleadoNombre}</strong> ha solicitado una ausencia y está pendiente de aprobación.
       </p>
       <table style="width:100%;font-size:14px;color:#475569;border-collapse:collapse;margin:12px 0">
         <tr><td style="padding:6px 0">Tipo</td><td style="padding:6px 0;color:#0f172a"><strong>${a.tipoAusencia.nombre}</strong></td></tr>
         <tr><td style="padding:6px 0">Desde</td><td style="padding:6px 0;color:#0f172a">${fmt(a.fechaInicio)}</td></tr>
         <tr><td style="padding:6px 0">Hasta</td><td style="padding:6px 0;color:#0f172a">${fmt(a.fechaFin)}</td></tr>
         <tr><td style="padding:6px 0">Días</td><td style="padding:6px 0;color:#0f172a">${a.dias}</td></tr>
         ${a.motivo ? `<tr><td style="padding:6px 0;vertical-align:top">Motivo</td><td style="padding:6px 0;color:#0f172a">${escapeHtml(a.motivo)}</td></tr>` : ""}
       </table>
       <p style="margin:18px 0 0;color:#475569">Revisa la solicitud y aprueba o rechaza desde el panel de ausencias.</p>`,
    );

    await Promise.allSettled(
      recipientes
        .filter((r) => r.id !== a.user.id && r.email)
        .map((r) => sendSystemEmail(r.email, subject, html)),
    );
  } catch (err) {
    console.error("[notifyAusenciaCreada]", err);
  }
}

export async function notifyAusenciaResuelta(a: AusenciaCtx): Promise<void> {
  try {
    const { enabled, empresa } = await getEnabled();
    if (!enabled) return;
    if (a.estado !== EstadoAusencia.APROBADA && a.estado !== EstadoAusencia.RECHAZADA) return;
    if (!a.user.email) return;

    const aprobada = a.estado === EstadoAusencia.APROBADA;
    const subject = aprobada
      ? `Tu solicitud de ausencia ha sido aprobada`
      : `Tu solicitud de ausencia ha sido rechazada`;
    const color = aprobada ? "#059669" : "#dc2626";
    const titulo = aprobada ? "Solicitud aprobada" : "Solicitud rechazada";

    const html = shellHtml(
      empresa,
      `<h2 style="margin:0 0 12px;font-size:18px;color:${color}">${titulo}</h2>
       <p style="margin:0 0 12px;color:#334155">
         Hola ${escapeHtml(a.user.nombre)}, tu solicitud de ausencia ha sido
         <strong style="color:${color}">${aprobada ? "aprobada" : "rechazada"}</strong>.
       </p>
       <table style="width:100%;font-size:14px;color:#475569;border-collapse:collapse;margin:12px 0">
         <tr><td style="padding:6px 0">Tipo</td><td style="padding:6px 0;color:#0f172a"><strong>${a.tipoAusencia.nombre}</strong></td></tr>
         <tr><td style="padding:6px 0">Desde</td><td style="padding:6px 0;color:#0f172a">${fmt(a.fechaInicio)}</td></tr>
         <tr><td style="padding:6px 0">Hasta</td><td style="padding:6px 0;color:#0f172a">${fmt(a.fechaFin)}</td></tr>
         <tr><td style="padding:6px 0">Días</td><td style="padding:6px 0;color:#0f172a">${a.dias}</td></tr>
         ${a.comentarioAdmin ? `<tr><td style="padding:6px 0;vertical-align:top">Comentario</td><td style="padding:6px 0;color:#0f172a">${escapeHtml(a.comentarioAdmin)}</td></tr>` : ""}
       </table>`,
    );

    await sendSystemEmail(a.user.email, subject, html);
  } catch (err) {
    console.error("[notifyAusenciaResuelta]", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
