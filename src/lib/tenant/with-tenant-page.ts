/**
 * HOF `withTenantPage` — equivalente de `withTenant` (route handlers)
 * para server components y layouts del subdominio del tenant.
 *
 * Bug 4 (descubierto en E2E real Fase 4): los page.tsx / layout.tsx
 * son server components, no route handlers. El HOF `withTenant` solo
 * envuelve handlers que exportan `GET`/`POST`. Las pages que usan
 * `prismaApp` directamente lanzan "No hay tenant en el contexto"
 * porque nadie las envuelve con `runWithTenant`.
 *
 * Uso:
 *
 *   import { withTenantPage } from "@/lib/tenant/with-tenant-page";
 *
 *   async function LoginPage({ searchParams }) {
 *     const branding = await prismaApp.configuracionEmpresa.findFirst(...);
 *     return <div>...</div>;
 *   }
 *
 *   export default withTenantPage(LoginPage);
 *
 * Diseño:
 *  - Lee el host del request via `headers()` (Next 16 server).
 *  - resolveTenant(host) → si no es subdominio tenant → notFound().
 *  - Si status != active → notFound() (defense in depth: el proxy ya
 *    debería haber respondido 503/402/410 antes).
 *  - runWithTenant alrededor de la función original.
 *
 * NO aplicable al root layout (`src/app/layout.tsx`) — ese sirve
 * múltiples hosts (apex, app, admin, tenant). El root layout debe
 * usar prismaMaster o branding default, no envolver runWithTenant.
 */

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTenant } from "@/lib/tenant/resolver";
import { runWithTenant } from "@/lib/tenant/context";
import type { ReactNode } from "react";

export function withTenantPage<
  P extends Record<string, unknown> = Record<string, unknown>,
>(fn: (props: P) => Promise<ReactNode> | ReactNode) {
  return async function TenantPageWrapped(props: P): Promise<ReactNode> {
    const h = await headers();
    const host = h.get("host") ?? "";
    const resolved = await resolveTenant(host);

    if (resolved.kind !== "tenant") {
      // Subdominio no es de tenant (apex/app/admin/invalid/not_found).
      // El proxy ya debería haber redirigido o respondido 404; si
      // llegamos aquí es un escenario de defense-in-depth.
      notFound();
    }

    if (resolved.ctx.status !== "active") {
      // Status no-active: el proxy debería responder antes con 503
      // (pending/provisioning), 402 (suspended) o 410 (deleted). Si
      // llegamos aquí, asumimos petición directa al render que esquiva
      // el proxy: 404 sin revelar el status real.
      notFound();
    }

    return runWithTenant(resolved.ctx, () => fn(props));
  };
}
