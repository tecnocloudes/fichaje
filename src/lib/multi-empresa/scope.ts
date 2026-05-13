/**
 * Helper de aislamiento por empresa para la feature `multi_empresa`.
 *
 * Modelo:
 * - Un tenant puede tener N filas en `Empresa` (CIFs distintos).
 * - Cada `User.empresaId` apunta opcionalmente a una empresa.
 * - Los OWNER **sin** `empresaId` son admins del grupo y ven TODAS las
 *   empresas. Los OWNER con `empresaId` quedan limitados a esa empresa.
 * - MANAGER/EMPLEADO siempre quedan limitados a su `empresaId` si lo
 *   tienen; si no lo tienen ven todo (compatibilidad con tenants
 *   single-empresa donde la feature está OFF).
 *
 * Si la feature `multi_empresa` está OFF para el tenant, el scope es
 * siempre null (sin filtro).
 */

import { currentTenant } from "@/lib/tenant/context";
import { prismaApp } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";

export interface EmpresaScope {
  /**
   * empresaId al que el viewer está limitado. null = sin filtro
   * (admin del grupo o feature OFF).
   */
  empresaId: string | null;
}

export async function resolveEmpresaScope(
  session: { user?: { id?: string; rol?: string } } | null | undefined,
): Promise<EmpresaScope> {
  if (!session?.user?.id) return { empresaId: null };
  const tenant = currentTenant();
  const feature = tenant?.features.get("multi_empresa");
  const featureActive = feature?.value === true;
  if (!featureActive) return { empresaId: null };

  const user = await prismaApp.user.findUnique({
    where: { id: session.user.id },
    select: { empresaId: true, rol: true },
  });
  if (!user) return { empresaId: null };

  // OWNER sin empresaId → admin del grupo, sin filtro.
  if (user.rol === Rol.OWNER && !user.empresaId) {
    return { empresaId: null };
  }
  return { empresaId: user.empresaId };
}

/**
 * Devuelve un fragmento `where` para Prisma que filtra por
 * `user.empresaId === scope.empresaId` cuando hay scope.
 * Acepta el path al campo user (default `userId` → asume relación
 * `user.empresaId`).
 *
 * Para queries directamente sobre `User`, usar `userScopeFilter`.
 */
export function fichajeScopeFilter(scope: EmpresaScope) {
  if (!scope.empresaId) return {};
  return { user: { empresaId: scope.empresaId } };
}

export function userScopeFilter(scope: EmpresaScope) {
  if (!scope.empresaId) return {};
  return { empresaId: scope.empresaId };
}
