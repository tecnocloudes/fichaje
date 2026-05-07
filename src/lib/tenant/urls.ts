/**
 * Construye URLs absolutas dentro del subdominio del tenant activo.
 *
 * Uso: para emails que llevan links a `<slug>.<root>/...` (set-password,
 * notificaciones de turno, etc). NO usar `NEXTAUTH_URL` directamente
 * porque esa apunta al subdominio `app` (registro/checkout), no al
 * subdominio del tenant.
 */

export function getRootDomain(): string {
  return process.env.TENANT_ROOT_DOMAIN ?? "empleaia.es";
}

export function tenantBaseUrl(slug: string): string {
  const root = getRootDomain();
  const isLocal = root === "localhost" || root.includes("localhost");
  const proto = isLocal ? "http" : "https";
  const port = isLocal ? ":3000" : "";
  return `${proto}://${slug}.${root}${port}`;
}

/**
 * Link a la página `/set-password?token=...` del tenant. Lo usa el
 * email de invitación al OWNER (post-checkout) y a empleados nuevos.
 */
export function buildSetPasswordUrl(slug: string, token: string): string {
  return `${tenantBaseUrl(slug)}/set-password?token=${token}`;
}
