/**
 * JWT del super-admin. ADR-007 §2.1 — audience claim "platform".
 *
 * Firma HS256 con `ADMIN_JWT_SECRET` (env). Distinto del secret de
 * NextAuth para evitar reutilización accidental de tokens.
 *
 * Si `ADMIN_JWT_SECRET` no está, fallback al secret de NextAuth
 * (`AUTH_SECRET`/`NEXTAUTH_SECRET`) en desarrollo. En producción
 * exigir ADMIN_JWT_SECRET separado.
 */

import { SignJWT, jwtVerify } from "jose";

const AUDIENCE = "platform";
const ISSUER = "fichaje-admin";

function getSecret(): Uint8Array {
  const v =
    process.env.ADMIN_JWT_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "";
  if (!v) {
    throw new Error(
      "ADMIN_JWT_SECRET / AUTH_SECRET / NEXTAUTH_SECRET vacío — no se puede firmar JWT super-admin",
    );
  }
  return new TextEncoder().encode(v);
}

export type SuperAdminJwt = {
  sub: string; // super_admin id
  email: string;
  role: "SUPER_ADMIN" | "SUPPORT";
  aud: typeof AUDIENCE;
  iss: typeof ISSUER;
  exp: number;
  iat: number;
};

export async function signSuperAdminJwt(
  payload: { id: string; email: string; role: "SUPER_ADMIN" | "SUPPORT" },
  ttlSeconds: number = 60 * 60 * 8, // 8h
): Promise<string> {
  return await new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.id)
    .setAudience(AUDIENCE)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(getSecret());
}

export async function verifySuperAdminJwt(
  token: string,
): Promise<SuperAdminJwt | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      audience: AUDIENCE,
      issuer: ISSUER,
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      (payload.role !== "SUPER_ADMIN" && payload.role !== "SUPPORT")
    ) {
      return null;
    }
    return payload as unknown as SuperAdminJwt;
  } catch {
    return null;
  }
}

export const ADMIN_COOKIE_NAME = "admin-session-token";
