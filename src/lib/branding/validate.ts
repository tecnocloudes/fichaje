/**
 * Validador puro de payloads de branding (logo/favicon).
 * Extraído para testabilidad. Plan Fase 6 §2.2.
 *
 * Acepta:
 *  - null / undefined / "" → ok (caller resetea el field).
 *  - data:image/<mime>;base64,... con MIME en allowlist.
 *  - Tamaño string ≤ MAX_IMAGE_BYTES * 1.4 (cota base64 ≈ 4/3 * bytes).
 */

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export const ALLOWED_IMAGE_MIMES = [
  "png",
  "jpeg",
  "webp",
  "svg+xml",
  "x-icon",
] as const;

const DATA_URL_RE =
  /^data:image\/(png|jpe?g|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/i;

export type ValidateResult =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown> };

export function validateImagePayload(
  value: unknown,
  field: "logo" | "favicon",
): ValidateResult {
  if (value === null || value === undefined || value === "") return { ok: true };
  if (typeof value !== "string") {
    return {
      ok: false,
      status: 400,
      body: { error: "image_format_invalid", field, reason: "no es string" },
    };
  }
  if (value.length > MAX_IMAGE_BYTES * 1.4) {
    return {
      ok: false,
      status: 413,
      body: { error: "image_too_large", field, max_bytes: MAX_IMAGE_BYTES },
    };
  }
  if (!DATA_URL_RE.test(value)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "image_format_invalid",
        field,
        allowed: [...ALLOWED_IMAGE_MIMES],
      },
    };
  }
  return { ok: true };
}
