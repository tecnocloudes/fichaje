/**
 * Parsing de Host header → categoría + slug. ADR-002 §2.1.
 *
 * Categorías:
 * - "tenant"  → `<slug>.ficha.tecnocloud.es` (subdominio del cliente).
 * - "app"     → `app.ficha.tecnocloud.es` (landing/registro/checkout).
 * - "admin"   → `admin.ficha.tecnocloud.es` (panel super-admin).
 * - "apex"    → `ficha.tecnocloud.es` (apex sin subdominio).
 * - "invalid" → host fuera del dominio o malformado.
 *
 * El "tenant" es el caso por defecto si el host está bajo el dominio raíz
 * y el slug pasa el regex (`^[a-z][a-z0-9_]{2,30}$`). Si el slug está en
 * la lista de reservados (api/www/cdn/...), parseHost devuelve "app" o
 * "admin" (cuando aplique) o "invalid" (slugs reservados sin uso definido).
 *
 * Soporte localhost en desarrollo: `<slug>.localhost`, `<slug>.localhost:3000`,
 * `dev.localhost` para el flow de desarrollo (CLAUDE.md npm run dev:seed-tenant).
 *
 * El dominio raíz se lee de `TENANT_ROOT_DOMAIN` (default
 * `ficha.tecnocloud.es`). En tests/dev se puede sobreescribir.
 */

const SLUG_REGEX = /^[a-z][a-z0-9_]{2,30}$/;

export type HostKind = "tenant" | "app" | "admin" | "apex" | "invalid";

export type ParsedHost =
  | { kind: "tenant"; slug: string }
  | { kind: "app" }
  | { kind: "admin" }
  | { kind: "apex" }
  | { kind: "invalid"; reason: string };

const RESERVED_TO_APP = new Set(["app", "www"]);
const RESERVED_TO_ADMIN = new Set(["admin"]);

function getRootDomain(): string {
  return process.env.TENANT_ROOT_DOMAIN ?? "ficha.tecnocloud.es";
}

/**
 * Quita puerto si existe (`:3000`) y baja a minúsculas. Lanza nada — devuelve
 * cadena vacía si el host es null/undefined.
 */
function normalize(host: string | null | undefined): string {
  if (!host) return "";
  return host.toLowerCase().split(":")[0]!.trim();
}

export function parseHost(rawHost: string | null | undefined): ParsedHost {
  const host = normalize(rawHost);
  if (!host) return { kind: "invalid", reason: "host vacío" };

  const root = getRootDomain();

  // Localhost desarrollo: tratamos como dominio root virtual.
  // - "localhost" → apex
  // - "<slug>.localhost" → tenant (si slug válido)
  if (host === "localhost") {
    return { kind: "apex" };
  }
  if (host.endsWith(".localhost")) {
    const slug = host.slice(0, -".localhost".length);
    return classifySubdomain(slug);
  }

  if (host === root) {
    return { kind: "apex" };
  }

  // Subdominio bajo el root.
  const suffix = "." + root;
  if (host.endsWith(suffix)) {
    const slug = host.slice(0, -suffix.length);
    if (slug.includes(".")) {
      // Sub-sub-dominios (p. ej. `foo.bar.ficha.tecnocloud.es`) no soportados.
      return { kind: "invalid", reason: "sub-subdominio no soportado" };
    }
    return classifySubdomain(slug);
  }

  return { kind: "invalid", reason: `host fuera de ${root}` };
}

function classifySubdomain(slug: string): ParsedHost {
  if (RESERVED_TO_APP.has(slug)) return { kind: "app" };
  if (RESERVED_TO_ADMIN.has(slug)) return { kind: "admin" };
  if (!SLUG_REGEX.test(slug)) {
    return { kind: "invalid", reason: `slug "${slug}" no cumple regex` };
  }
  return { kind: "tenant", slug };
}
