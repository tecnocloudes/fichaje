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
  // Healthcheck: bypass total. Lo invocan Dokploy/Docker/k8s con el
  // host del balanceador interno o por IP — no debe pasar por la
  // resolución de tenant (que daría 301 a app.<root>).
  if (req.nextUrl.pathname === "/api/healthz") {
    return NextResponse.next();
  }

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
    // Fase 7: panel super-admin disponible. Las páginas viven en
    // src/app/admin/* y los endpoints en src/app/api/admin/*.
    // Ambos prefijos son válidos en el subdominio admin.<root>.
    const adminUrl = new URL(req.url);
    if (
      !adminUrl.pathname.startsWith("/admin") &&
      !adminUrl.pathname.startsWith("/api/admin")
    ) {
      // Redirigir cualquier otro path al login del panel.
      return NextResponse.redirect(new URL("/admin/login", adminUrl));
    }
    return NextResponse.next();
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

  // El panel super-admin vive en admin.<root>, NO en app.<root>.
  // Si alguien accede a app.<root>/admin/* o /api/admin/*, redirigimos
  // al subdominio correcto. Sin este redirect, NextAuth (que sirve
  // app.*) intercepta y mete cookies CSRF de tenant en el panel
  // super-admin, dejándolo inutilizable.
  if (
    nextUrl.pathname.startsWith("/admin") ||
    nextUrl.pathname.startsWith("/api/admin")
  ) {
    const root = getRootDomain();
    const adminUrl = new URL(req.url);
    adminUrl.host = `admin.${root}`;
    adminUrl.port = "";
    adminUrl.protocol = "https:";
    return NextResponse.redirect(adminUrl, 308);
  }

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
  // Excluimos del proxy:
  // - assets de Next (_next/static, _next/image)
  // - favicon estático en public/ (legacy)
  // - directorio /icons
  // - cualquier .png
  // - /icon y /apple-icon — generados por Next desde
  //   src/app/icon.tsx y src/app/apple-icon.tsx (convención
  //   App Router metadata). Sin esta exclusión, el proxy
  //   redirige a /login al no haber sesión y rompe el favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|icon|apple-icon|.*\\.png$).*)"],
};
