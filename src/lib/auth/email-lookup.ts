/**
 * Búsqueda global de un email en TODOS los tenants activos.
 *
 * Uso: el formulario de login global en app.<root>/login pide solo
 * el email. El backend itera tenants activos buscando un User con
 * ese email. Devuelve la lista de slugs en los que el email existe
 * — uno solo en el caso típico, varios si la persona trabaja en
 * múltiples empresas con el mismo correo.
 *
 * Coste: O(N) en nº de tenants activos. Para <500 tenants es
 * trivial (cada lookup ≈1ms). A escala mayor, sustituir por un
 * índice global en master.* sincronizado al crear/borrar Users.
 */

import { prismaMaster, prismaApp } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant/context";

export interface TenantMatch {
  slug: string;
  empresa: string;
}

export async function lookupTenantsByEmail(email: string): Promise<TenantMatch[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];

  const tenants = await prismaMaster.tenant.findMany({
    where: { status: "active" },
    select: { id: true, slug: true, name: true },
  });

  const matches: TenantMatch[] = [];
  for (const t of tenants) {
    try {
      const found = await runWithTenant(
        { tenantId: t.id, slug: t.slug, status: "active", features: new Map() },
        async () => {
          return prismaApp.user.findUnique({
            where: { email: normalized },
            select: { id: true, activo: true },
          });
        },
      );
      if (found?.activo) {
        matches.push({ slug: t.slug, empresa: t.name });
      }
    } catch {
      // Schema podría no tener tabla User aún (provisioning a medias).
      // Lo ignoramos en silencio — el usuario verá "no encontrado".
    }
  }
  return matches;
}
