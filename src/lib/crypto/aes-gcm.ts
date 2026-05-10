/**
 * AES-256-GCM cifrado simétrico para datos sensibles del tenant
 * (API keys de IA, embeddings biométricos de Face ID).
 *
 * Clave maestra: env `IA_ENCRYPTION_KEY` (32 bytes hex = 64 chars).
 *   Generar una vez:  node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
 *
 * Formato persistido (Buffer):  [12 bytes IV][N bytes ciphertext][16 bytes authTag]
 *
 * Si `IA_ENCRYPTION_KEY` cambia o se pierde, todos los datos cifrados
 * (API keys, embeddings) quedan irrecuperables. Documenta esto al cliente
 * y guarda backup de la clave en gestor de secretos.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.IA_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "IA_ENCRYPTION_KEY no está definida. Genera 32 bytes hex y configúrala en el entorno antes de usar IA o Face ID.",
    );
  }
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(
      "IA_ENCRYPTION_KEY debe ser 32 bytes en hex (64 chars hexadecimales).",
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Cifra un payload (string o Uint8Array) y devuelve un Uint8Array
 * listo para persistir en una columna `bytea` de Postgres (Prisma 7
 * usa Uint8Array para Bytes, no Buffer).
 */
export function encrypt(payload: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const data =
    typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  const concat = Buffer.concat([iv, encrypted, tag]);
  // Copia explícita sobre un ArrayBuffer puro para satisfacer el tipo
  // `Uint8Array<ArrayBuffer>` que requiere Prisma 7 en columnas Bytes
  // (sin esto TS lo infiere como Uint8Array<ArrayBufferLike>).
  const ab = new ArrayBuffer(concat.byteLength);
  const out = new Uint8Array(ab);
  out.set(concat);
  return out;
}

/**
 * Descifra un blob producido por `encrypt`. Lanza si el authTag
 * no valida (manipulación detectada).
 */
export function decrypt(blob: Uint8Array): Uint8Array<ArrayBuffer> {
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Blob cifrado demasiado corto");
  }
  const buf = Buffer.from(blob);
  const key = getKey();
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const ab = new ArrayBuffer(plaintext.byteLength);
  const out = new Uint8Array(ab);
  out.set(plaintext);
  return out;
}

/** Helpers convenience para strings (JSON, API keys, etc). */
export function encryptString(s: string): Uint8Array<ArrayBuffer> {
  return encrypt(s);
}

export function decryptString(blob: Uint8Array): string {
  return Buffer.from(decrypt(blob)).toString("utf8");
}

/** Helpers convenience para Float32Array (embeddings biométricos). */
export function encryptFloat32(arr: Float32Array): Uint8Array<ArrayBuffer> {
  return encrypt(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
}

export function decryptFloat32(blob: Uint8Array): Float32Array {
  const buf = decrypt(blob);
  // Copiamos a un buffer alineado por seguridad (Float32Array requiere
  // alineamiento a 4 bytes).
  const aligned = new Uint8Array(buf);
  return new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4);
}
