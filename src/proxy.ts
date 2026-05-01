/**
 * Proxy de Next 16 (renombrado desde middleware.ts en commit 7). ADR-002.
 *
 * Verificado empíricamente en Fase 3 — riesgo §11.3 confirmado abierto:
 * Next 16 NO propaga el `runWithTenant` de este proxy al handler de la
 * ruta API (corren en continuaciones distintas). Por eso:
 *
 *  - Este proxy YA NO envuelve con runWithTenant.
 *  - Cada handler en src/app/api/** aplica explícitamente el HOF
 *    `withTenant` (src/lib/tenant/with-tenant.ts) que re-resuelve el
 *    tenant desde host (cache hit gratis) y reanida runWithTenant.
 *
 * El proxy mantiene:
 *  - parseHost: distinguir tenant vs subdominio reservado vs apex.
 *  - 301 apex → app.<root>.
 *  - status check + códigos HTTP (defensa en profundidad: si un handler
 *    se olvida del HOF, el proxy ya devuelve 503/402/410 antes).
 *  - Cache de tenant (resolveTenant con cache compartido).
 *  - Auth wrapping (NextAuth) para el redirect /login en páginas.
 *
 * Lo que se ha movido al HOF withTenant:
 *  - JWT cross-validation (slug del host vs JWT.tenantSlug → 401).
 *  - runWithTenant.
 */

import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse, type NextRequest } from "next/server";
import { resolveTenant } from "@/lib/tenant/resolver";
import { isPublicAuthPath } from "@/proxy-paths";

const { auth } = NextAuth(authConfig);

type AuthedRequest = NextRequest & {
  auth: { user?: { rol?: string; tenantSlug?: string } } | null;
};

function getRootDomain(): string {
  return process.env.TENANT_ROOT_DOMAIN ?? "ficha.tecnocloud.es";
}

export default auth(async (req) => {
  const host = req.headers.get("host");
  const resolved = await resolveTenant(host);

  if (resolved.kind === "apex") {
    const url = new URL(req.url);
    const root = getRootDomain();
    url.host = `app.${root}`;
    url.port = "";
    return NextResponse.redirect(url, 301);
  }

  if (resolved.kind === "app") {
    return appSubdomainHandler(req as AuthedRequest);
  }

  if (resolved.kind === "admin") {
    return new NextResponse("Panel super-admin pendiente (Fase 7)", {
      status: 503,
      headers: { "retry-after": "300" },
    });
  }

  if (resolved.kind === "invalid" || resolved.kind === "not_found") {
    return new NextResponse("Not Found", { status: 404 });
  }

  // resolved.kind === "tenant"
  const ctx = resolved.ctx;

  if (ctx.status === "pending" || ctx.status === "provisioning") {
    return new NextResponse(
      ctx.status === "pending"
        ? "Cuenta pendiente de pago"
        : "Cuenta en preparación",
      { status: 503, headers: { "retry-after": "30" } },
    );
  }
  if (ctx.status === "suspended") {
    return new NextResponse("Cuenta suspendida. Revisa la facturación.", {
      status: 402,
    });
  }
  if (ctx.status === "deleted") {
    return new NextResponse("Cuenta eliminada", { status: 410 });
  }

  // status === "active": el handler aplicará withTenant si toca BD del
  // producto. El proxy solo aplica los redirects de auth basados en rol.
  return tenantSubdomainHandler(req as AuthedRequest);
});

function appSubdomainHandler(req: AuthedRequest): NextResponse {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const isAuthPage = nextUrl.pathname.startsWith("/login");
  const isApiRoute = nextUrl.pathname.startsWith("/api");

  if (isApiRoute) return NextResponse.next();
  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }
  return NextResponse.next();
}

function tenantSubdomainHandler(req: AuthedRequest): NextResponse {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const rol = req.auth?.user?.rol;

  // PUBLIC_AUTH_PATHS + isPublicAuthPath en src/proxy-paths.ts
  // (matcher exacto/prefijo-slash, no laxo). Bug 5 Fase 4.
  const isAuthPage = isPublicAuthPath(nextUrl.pathname);
  const isApiRoute = nextUrl.pathname.startsWith("/api");

  if (isApiRoute) return NextResponse.next();
  // /setup eliminado en Fase 4 (legacy mono-tenant; reemplazado por
  // flow Stripe en subdominio app).

  if (!isLoggedIn && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  if (isLoggedIn && isAuthPage) {
    if (rol === "OWNER") return NextResponse.redirect(new URL("/admin", nextUrl));
    if (rol === "MANAGER")
      return NextResponse.redirect(new URL("/manager", nextUrl));
    return NextResponse.redirect(new URL("/empleado", nextUrl));
  }

  if (isLoggedIn) {
    const path = nextUrl.pathname;
    if (path.startsWith("/admin") && rol !== "OWNER") {
      return NextResponse.redirect(new URL("/empleado", nextUrl));
    }
    if (path.startsWith("/manager") && rol !== "MANAGER" && rol !== "OWNER") {
      return NextResponse.redirect(new URL("/empleado", nextUrl));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|.*\\.png$).*)"],
};
