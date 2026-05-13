/**
 * Conector Google Workspace del marketplace (SCIM-lite).
 *
 * Importa empleados desde Google Directory API. Activación:
 * - El OWNER instala la integración `google_workspace` y guarda en
 *   `IntegracionInstalada.configuracion`:
 *     - `accessToken`: token OAuth2 con scope `admin.directory.user.readonly`.
 *       Lo más rápido: usar OAuth Playground (developers.google.com/oauthplayground)
 *       o un service account con domain-wide delegation. Sin renovación
 *       automática — si caduca el OWNER actualiza la config.
 *     - `customer` (opcional): id del customer Workspace, default `my_customer`.
 *     - `domain` (opcional): si tienes varios dominios, fija uno.
 *
 * El sync:
 * - Lista usuarios de Directory API (paginado).
 * - Por cada email match, actualiza nombre/apellidos/foto. Por cada
 *   email nuevo, crea un User con rol EMPLEADO (activo=true, sin
 *   password — el OWNER manda el link de set-password manualmente).
 * - No borra usuarios (deactivation hard de SCIM se deja como futuro).
 */

import { prismaApp } from "@/lib/prisma";

const DIRECTORY_BASE = "https://admin.googleapis.com/admin/directory/v1/users";

interface GoogleUser {
  primaryEmail: string;
  name?: { givenName?: string; familyName?: string };
  thumbnailPhotoUrl?: string;
  suspended?: boolean;
}

interface GoogleConfig {
  accessToken: string;
  customer?: string;
  domain?: string;
}

export interface SyncReport {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

async function fetchAllUsers(config: GoogleConfig): Promise<GoogleUser[]> {
  const all: GoogleUser[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      customer: config.customer ?? "my_customer",
      maxResults: "200",
      projection: "basic",
    });
    if (config.domain) params.set("domain", config.domain);
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${DIRECTORY_BASE}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Directory API ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      users?: GoogleUser[];
      nextPageToken?: string;
    };
    if (data.users) all.push(...data.users);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}

export async function syncEmpleadosFromGoogle(): Promise<SyncReport> {
  const integ = await prismaApp.integracion.findUnique({
    where: { slug: "google_workspace" },
    include: {
      instalaciones: {
        where: { activa: true },
        select: { configuracion: true },
        take: 1,
      },
    },
  });
  if (!integ || integ.instalaciones.length === 0) {
    throw new Error("Google Workspace no está instalado para este tenant.");
  }
  const config = integ.instalaciones[0].configuracion as GoogleConfig | null;
  if (!config?.accessToken) {
    throw new Error("Falta accessToken en la configuración de Google Workspace.");
  }

  const report: SyncReport = {
    scanned: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  let users: GoogleUser[];
  try {
    users = await fetchAllUsers(config);
  } catch (err) {
    report.errors.push((err as Error).message);
    return report;
  }
  report.scanned = users.length;

  for (const gu of users) {
    if (gu.suspended) {
      report.skipped++;
      continue;
    }
    const email = gu.primaryEmail.trim().toLowerCase();
    const nombre = gu.name?.givenName?.trim() || "(sin nombre)";
    const apellidos = gu.name?.familyName?.trim() || "";
    try {
      const existing = await prismaApp.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) {
        await prismaApp.user.update({
          where: { email },
          data: {
            nombre,
            apellidos,
            foto: gu.thumbnailPhotoUrl ?? undefined,
          },
        });
        report.updated++;
      } else {
        await prismaApp.user.create({
          data: {
            email,
            nombre,
            apellidos,
            foto: gu.thumbnailPhotoUrl ?? undefined,
            rol: "EMPLEADO",
            password: null,
            activo: true,
          },
        });
        report.created++;
      }
    } catch (err) {
      report.errors.push(`${email}: ${(err as Error).message}`);
    }
  }

  return report;
}
