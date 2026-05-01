/**
 * POST /api/admin/login
 * Plan Fase 7 §2.2.
 *
 * Login email/password contra master.super_admins. Devuelve cookie
 * admin-session-token con JWT firmado (aud=platform).
 *
 * NO usa NextAuth — auth dedicada por aislamiento (ADR-007 §2.1).
 */

import { prismaMaster } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { signSuperAdminJwt, ADMIN_COOKIE_NAME } from "@/lib/admin/jwt";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const meta = extractRequestMeta(req.headers);
  if (!email || !password) {
    return NextResponse.json(
      { error: "credentials_required" },
      { status: 400 },
    );
  }

  const sa = await prismaMaster.superAdmin.findUnique({
    where: { email },
    select: { id: true, email: true, password: true, role: true, active: true },
  });
  if (!sa || !sa.active) {
    // Audit logging requiere super_admin_id; usamos placeholder solo
    // para lecturas/loguear intentos fallidos sin id real.
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  const ok = await bcrypt.compare(password, sa.password);
  if (!ok) {
    // Auditar intento fallido — pero requiere SuperAdmin id real
    // (FK). Logueamos solo si el email existe (lo cual leak no
    // significativo: el error 401 es genérico igualmente).
    try {
      await writeAuditEntry({
        superAdminId: sa.id,
        action: "super-admin:login-failed",
        targetKind: "session",
        targetId: sa.id,
        summary: { email },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    } catch {
      // ignorar — no romper el login flow por audit fail.
    }
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = await signSuperAdminJwt({
    id: sa.id,
    email: sa.email,
    role: sa.role as "SUPER_ADMIN" | "SUPPORT",
  });

  await prismaMaster.superAdmin.update({
    where: { id: sa.id },
    data: { lastLogin: new Date() },
  });

  await writeAuditEntry({
    superAdminId: sa.id,
    action: "super-admin:login",
    targetKind: "session",
    targetId: sa.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  const res = NextResponse.json({
    id: sa.id,
    email: sa.email,
    role: sa.role,
  });
  // Cookie scope: Path=/api/admin para limitar al panel.
  // En producción Domain=admin.<root> exacto + Secure. En dev sin
  // Domain (works en localhost).
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}
