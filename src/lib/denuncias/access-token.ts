/**
 * Tokens de acceso para informantes anónimos del canal de denuncias.
 *
 * Patrón: el plain token se devuelve UNA SOLA VEZ al crear la denuncia.
 * Lo que se persiste en BD es `accessTokenHash` (sha256). Si el informante
 * pierde el token, no hay forma de recuperarlo — alineado con la promesa
 * de anonimato real del Ley 2/2023.
 */

import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

/**
 * Genera un token nuevo + su hash para guardar.
 * Devuelve el plain (mostrar al informante UNA vez) y el hash (persistir).
 */
export function generateAccessToken(): { plain: string; hash: string } {
  const buf = randomBytes(TOKEN_BYTES);
  const plain = buf.toString("base64url");
  const hash = hashAccessToken(plain);
  return { plain, hash };
}

/**
 * Hashea un token con SHA-256. Determinista — usado para lookups.
 */
export function hashAccessToken(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}
