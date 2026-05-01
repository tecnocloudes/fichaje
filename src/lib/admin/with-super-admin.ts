/**
 * HOF withSuperAdmin — análogo a withTenant pero para handlers del
 * panel super-admin.
 *
 * - Lee cookie ADMIN_COOKIE_NAME del request.
 * - Verifica JWT con `aud=platform` + `iss=fichaje-admin`.
 * - Verifica que el SuperAdmin existe y `active=true` en BD.
 * - Inyecta `currentSuperAdmin()` con runWithSuperAdmin.
 * - 401 si falta o es inválido.
 *
 * Defensa en profundidad: aunque el proxy clasifique el host como
 * "admin", este HOF NO confía en el host — exige cookie + JWT válido.
 */

import { type NextRequest, NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { runWithSuperAdmin, type SuperAdminContext } from "./context";
import { verifySuperAdminJwt, ADMIN_COOKIE_NAME } from "./jwt";

type Handler<Args extends unknown[]> = (
  req: NextRequest,
  ...rest: Args
) => Promise<Response> | Response;

export function withSuperAdmin<Args extends unknown[]>(
  handler: Handler<Args>,
): Handler<Args> {
  return async (req, ...rest) => {
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const claims = await verifySuperAdminJwt(token);
    if (!claims) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    // Defensa adicional: el SuperAdmin debe seguir activo en BD.
    const sa = await prismaMaster.superAdmin.findUnique({
      where: { id: claims.sub },
      select: { id: true, email: true, role: true, active: true },
    });
    if (!sa || !sa.active) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const ctx: SuperAdminContext = {
      id: sa.id,
      email: sa.email,
      role: sa.role as "SUPER_ADMIN" | "SUPPORT",
    };
    return runWithSuperAdmin(ctx, () => handler(req, ...rest));
  };
}
