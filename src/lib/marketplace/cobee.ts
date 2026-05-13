/**
 * Conector Cobee del módulo retribución flexible.
 *
 * Cobee (cobee.io) es la plataforma B2B de retribución flexible más
 * extendida en España. La API es privada — requiere acuerdo de
 * partner para credenciales reales. Mientras tanto, este módulo:
 *
 * 1. Si el tenant tiene instalada la integración `cobee` en el
 *    marketplace con `apiKey` + opcional `baseUrl`, llama a la API
 *    real con el formato estándar REST. Si Cobee cambia el contrato
 *    se ajusta el body en `emitirTicketsCobee`.
 *
 * 2. Si no está instalada, devuelve modo simulación con el desglose
 *    de tickets que SE EMITIRÍAN. El OWNER lo usa como vista previa.
 *
 * El emisor no toca la BD — el caller debe persistir el resultado
 * en `DeclaracionFlex` (campo "emitido"/"providerRef" futuro) si
 * quiere trazabilidad.
 */

import { prismaApp } from "@/lib/prisma";

const COBEE_DEFAULT_BASE = "https://api.cobee.io/v1";

export interface CobeeTicket {
  empleadoId: string;
  empleadoEmail: string;
  empleadoDni: string | null;
  concepto: string;
  importe: number;
  periodo: string;
}

export interface EmitResult {
  modo: "live" | "simulado";
  enviados: number;
  fallidos: number;
  errores: { empleado: string; error: string }[];
  total: number;
  /** Tickets que se enviaron (con providerRef si modo=live). */
  tickets: (CobeeTicket & { providerRef?: string })[];
}

interface CobeeConfig {
  apiKey: string;
  baseUrl?: string;
  companyId?: string;
}

async function postTicket(
  cfg: CobeeConfig,
  ticket: CobeeTicket,
): Promise<{ ok: boolean; providerRef?: string; error?: string }> {
  const url = `${cfg.baseUrl ?? COBEE_DEFAULT_BASE}/benefits/tickets`;
  const body = {
    company_id: cfg.companyId,
    employee_email: ticket.empleadoEmail,
    employee_external_id: ticket.empleadoId,
    benefit_type: ticket.concepto,
    amount: ticket.importe,
    currency: "EUR",
    period: ticket.periodo,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      error?: string;
    };
    if (!res.ok || data.error) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, providerRef: data.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function emitirTicketsCobee(
  tickets: CobeeTicket[],
): Promise<EmitResult> {
  const integ = await prismaApp.integracion.findUnique({
    where: { slug: "cobee" },
    include: {
      instalaciones: {
        where: { activa: true },
        select: { configuracion: true },
        take: 1,
      },
    },
  });
  const cfg = integ?.instalaciones[0]?.configuracion as CobeeConfig | null | undefined;
  const live = !!cfg?.apiKey;

  const total = tickets.reduce((sum, t) => sum + t.importe, 0);

  if (!live) {
    return {
      modo: "simulado",
      enviados: tickets.length,
      fallidos: 0,
      errores: [],
      total,
      tickets,
    };
  }

  const result: EmitResult = {
    modo: "live",
    enviados: 0,
    fallidos: 0,
    errores: [],
    total,
    tickets: [],
  };
  for (const t of tickets) {
    const r = await postTicket(cfg, t);
    if (r.ok) {
      result.enviados++;
      result.tickets.push({ ...t, providerRef: r.providerRef });
    } else {
      result.fallidos++;
      result.errores.push({ empleado: t.empleadoEmail, error: r.error ?? "?" });
    }
  }
  return result;
}
