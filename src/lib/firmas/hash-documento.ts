import { createHash } from "node:crypto";

/**
 * Genera el hash SHA-256 del contenido (URL + título + tamaño) de un
 * documento en el momento de la firma. Sirve como sello probatorio:
 * si alguien modifica el documento después, el hash cambia y queda
 * trazado en BD que la firma fue sobre el contenido original.
 *
 * Para una firma cualificada (eIDAS QES) habría que integrar con un
 * proveedor (DocuSign / Signaturit) y guardar el certificado X.509.
 * Esto es el primer paso (firma simple avanzada).
 */
export function hashDocumento(contenido: string): string {
  return createHash("sha256").update(contenido, "utf8").digest("hex");
}
