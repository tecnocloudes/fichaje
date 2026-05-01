/**
 * Auth de la API pública /api/v1/**. Plan D.1.
 *
 * Token format: `<prefix>_<secret>` donde prefix es 8 chars hex
 * (público, identifica el token sin compromiso) y secret es 32 chars
 * hex (oculto, hash bcrypt en BD).
 *
 * Validación:
 *  1. Lookup por prefix.
 *  2. bcrypt.compare(secret, tokenHash).
 *  3. Verificar revokedAt + expiresAt.
 *  4. Verificar tenant matches el del host (defense vs cross-tenant).
 *  5. Update lastUsedAt fire-and-forget.
 */

import { prismaMaster } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

export type AuthResult =
  | { ok: true; tenantId: string; tokenId: string }
  | { ok: false; reason: "missing" | "malformed" | "invalid" | "expired" | "revoked" | "wrong_tenant" };

export function generateToken(): { plain: string; prefix: string; secret: string } {
  const prefix = randomBytes(4).toString("hex"); // 8 chars
  const secret = randomBytes(16).toString("hex"); // 32 chars
  return { plain: `${prefix}_${secret}`, prefix, secret };
}

export async function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10);
}

function parseAuthHeader(headers: Headers): string | null {
  const a = headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(a);
  return m?.[1]?.trim() ?? null;
}

export async function authenticateApiToken(
  headers: Headers,
  expectedTenantId: string,
): Promise<AuthResult> {
  const raw = parseAuthHeader(headers);
  if (!raw) return { ok: false, reason: "missing" };
  const idx = raw.indexOf("_");
  if (idx <= 0) return { ok: false, reason: "malformed" };
  const prefix = raw.slice(0, idx);
  const secret = raw.slice(idx + 1);
  const token = await prismaMaster.apiToken.findUnique({
    where: { prefix },
    select: {
      id: true,
      tenantId: true,
      tokenHash: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (!token) return { ok: false, reason: "invalid" };
  const ok = await bcrypt.compare(secret, token.tokenHash);
  if (!ok) return { ok: false, reason: "invalid" };
  if (token.revokedAt) return { ok: false, reason: "revoked" };
  if (token.expiresAt && token.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (token.tenantId !== expectedTenantId) {
    return { ok: false, reason: "wrong_tenant" };
  }
  // fire-and-forget update lastUsedAt
  prismaMaster.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { ok: true, tenantId: token.tenantId, tokenId: token.id };
}
