/**
 * Quoting seguro del nombre de schema del tenant. ADR-001 §2.5.
 *
 * `SET search_path TO ...` en SQL es **interpolación textual**: el cliente
 * Postgres no permite parametrizar el nombre del schema con `$1`. Por eso
 * el slug se inyecta como identificador y debe estar pre-validado contra
 * un regex estricto antes de envolverlo en comillas dobles.
 *
 * Doble validación:
 *  1. Regex `^[a-z][a-z0-9_]{2,30}$` — minúsculas, dígitos, guion bajo;
 *     empieza por letra; longitud 3-31.
 *  2. Encierra el resultado en comillas dobles (`"..."`) — Postgres trata
 *     todo el contenido como identificador literal. Junto al regex, esto
 *     bloquea `;`, `--`, `'`, `"`, `\`, `\n` y cualquier carácter fuera
 *     del set permitido.
 *
 * Lanza si el slug no pasa el regex. La query falla antes de tocar BD.
 *
 * El CHECK constraint en master.tenants.slug aplica el mismo regex en BD,
 * así que esta función actúa como segunda barrera (defensa en profundidad).
 */

const SLUG_REGEX = /^[a-z][a-z0-9_]{2,30}$/;

export class InvalidTenantSlugError extends Error {
  constructor(slug: unknown) {
    super(
      `Slug inválido: ${JSON.stringify(slug)}. Debe coincidir con ` +
        `^[a-z][a-z0-9_]{2,30}$ (minúsculas, dígitos, guion bajo; ` +
        `empieza por letra; longitud 3-31).`,
    );
    this.name = "InvalidTenantSlugError";
  }
}

/**
 * Devuelve el identificador SQL `"tenant_<slug>"` listo para inyectar en
 * `SET search_path`. Lanza `InvalidTenantSlugError` si el slug no pasa
 * el regex.
 *
 * @example
 *   quoteSchemaName("acme")        // → '"tenant_acme"'
 *   quoteSchemaName("acme_v2")     // → '"tenant_acme_v2"'
 *   quoteSchemaName("Acme")        // → throw
 *   quoteSchemaName("ab")          // → throw (longitud < 3)
 *   quoteSchemaName("a; DROP")     // → throw
 */
export function quoteSchemaName(slug: string): string {
  if (typeof slug !== "string" || !SLUG_REGEX.test(slug)) {
    throw new InvalidTenantSlugError(slug);
  }
  return `"tenant_${slug}"`;
}

/**
 * Variante booleana sin throw, útil para validar antes de mostrar errores
 * al usuario en formularios (registro, panel super-admin).
 */
export function isValidTenantSlug(slug: unknown): slug is string {
  return typeof slug === "string" && SLUG_REGEX.test(slug);
}
