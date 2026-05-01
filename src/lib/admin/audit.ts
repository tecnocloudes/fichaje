/**
 * Helper de escritura del audit_log. ADR-007 §2.4 + §2.7.
 *
 * Cualquier handler del panel super-admin que mute estado o lea datos
 * sensibles llama a `writeAuditEntry()` después de la operación.
 *
 * Severity se infiere del catálogo cerrado (`AUDIT_ACTIONS`) — no se
 * pasa como parámetro para evitar errores de calibración.
 *
 * Si el INSERT falla, NO se loga al stdout (el caller debería ya tener
 * registro de la operación primaria); pero sí se relanza para que el
 * handler decida si rollback (acciones críticas).
 */

import { prismaMaster } from "@/lib/prisma";
import { type AuditAction, severityOf } from "./audit-actions";

export type AuditEntryArgs = {
  superAdminId: string;
  action: AuditAction;
  targetKind: string;
  targetId: string;
  summary?: Record<string, unknown>;
  dumpPath?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function writeAuditEntry(args: AuditEntryArgs): Promise<void> {
  await prismaMaster.auditLog.create({
    data: {
      superAdminId: args.superAdminId,
      action: args.action,
      targetKind: args.targetKind,
      targetId: args.targetId,
      severity: severityOf(args.action),
      summary: (args.summary ?? {}) as never,
      dumpPath: args.dumpPath ?? null,
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    },
  });
}

/** Helper para extraer ip + UA de un Request.headers. */
export function extractRequestMeta(headers: Headers): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const fwd = headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : null;
  return { ipAddress: ip, userAgent: headers.get("user-agent") ?? null };
}
