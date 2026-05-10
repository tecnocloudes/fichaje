/**
 * Token HMAC corto + single-use para certificar Face ID server-side.
 *
 * Flujo:
 *   1. Cliente captura embedding → `POST /api/face/verify`.
 *   2. Si match, server emite `faceVerifyToken` con `issueFaceToken(userId, tenantSlug)`.
 *      Body del token: `userId|tenantSlug|exp|nonce` firmado con HMAC-SHA256.
 *      TTL: 60s. Nonce: 16 bytes randomBytes.
 *   3. Cliente lo manda a `POST /api/fichajes` en el mismo flow.
 *   4. Server valida con `consumeFaceToken(token, userId, tenantSlug)`:
 *      firma OK + no expirado + tenant correcto + userId correcto + nonce no consumido.
 *
 * El nonce se marca como consumido en un Map in-memory con TTL 90s
 * (margen sobre los 60s del token). Suficiente para single-use por
 * réplica; si se escala horizontalmente, migrar a Redis.
 *
 * Clave: HMAC se deriva de `IA_ENCRYPTION_KEY` (la misma que cifra los
 * embeddings). Sin esa clave no se pueden forjar tokens.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 60_000;
const NONCE_RETENTION_MS = 90_000;

const CONSUMED_NONCES: Map<string, number> =
  (globalThis as { _faceTokenNonces?: Map<string, number> })._faceTokenNonces ??
  ((globalThis as { _faceTokenNonces?: Map<string, number> })._faceTokenNonces = new Map());

function getSecret(): Buffer {
  const hex = process.env.IA_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error("IA_ENCRYPTION_KEY ausente o malformada — no se puede emitir/validar Face ID token.");
  }
  return Buffer.from(hex, "hex");
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function gcConsumed(): void {
  const now = Date.now();
  for (const [nonce, exp] of CONSUMED_NONCES) {
    if (exp <= now) CONSUMED_NONCES.delete(nonce);
  }
}

/**
 * Emite un token. Devuelve la cadena `<payload>.<signature>` — opaca para el cliente.
 */
export function issueFaceToken(userId: string, tenantSlug: string): string {
  const exp = Date.now() + TTL_MS;
  const nonce = randomBytes(16).toString("hex");
  const payload = `${userId}|${tenantSlug}|${exp}|${nonce}`;
  const sig = sign(payload);
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_tenant" | "wrong_user" | "already_used" };

/**
 * Valida y CONSUME el token. Tras una llamada exitosa, el mismo token
 * no podrá usarse de nuevo.
 */
export function consumeFaceToken(token: string, userId: string, tenantSlug: string): ConsumeResult {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, sigB64] = token.split(".", 2) as [string, string];
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const expectedSig = sign(payload);
  let sigOk = false;
  try {
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expectedSig);
    sigOk = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, reason: "bad_signature" };

  const parts = payload.split("|");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [tokUser, tokTenant, expStr, nonce] = parts as [string, string, string, string];
  const exp = Number(expStr);

  if (!Number.isFinite(exp) || Date.now() > exp) {
    return { ok: false, reason: "expired" };
  }
  if (tokTenant !== tenantSlug) return { ok: false, reason: "wrong_tenant" };
  if (tokUser !== userId) return { ok: false, reason: "wrong_user" };

  gcConsumed();
  if (CONSUMED_NONCES.has(nonce)) {
    return { ok: false, reason: "already_used" };
  }
  CONSUMED_NONCES.set(nonce, Date.now() + NONCE_RETENTION_MS);
  return { ok: true };
}
