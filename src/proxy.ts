/**
 * Proxy de Next 16 (renombrado desde middleware.ts en commit 7). ADR-002.
 *
 * Flow por request:
 *  1. Extraer Host header.
 *  2. resolveTenant(host) → { kind, ... } con cache.
 *  3. Routing por kind:
 *     - "apex"           → 301 a app.<root>.
 *     - "app"            → handler de subdominio app (login global,
 *                            registro Fase 4, webhooks Stripe Fase 4).
 *                            NO runWithTenant.
 *     - "admin"          → 503 "panel pendiente" (Fase 7 lo materializa).
 *                            NO runWithTenant.
 *     - "invalid"/"not_found" → 404 (indistinguible).
 *     - "tenant"         → validar status:
 *         - pending/provisioning → 503 + Retry-After: 30.
 *         - suspended            → 402.
 *         - deleted              → 410.
 *         - active               → runWithTenant(ctx, () => authFlow(req)).
 *
 * El JWT cross-validation (slug del host vs JWT.tenantSlug → 401) se
 * añade en commit 9 cuando el callback JWT ya guarde tenantSlug.
 *
 * Runtime: Node.js (default Next 16, proxy.md línea 219). AsyncLocalStorage
 * nativo. Server actions y route handlers heredan el ctx envuelto aquí.
 */

import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse, type NextRequest } from "next/server";
import { resolveTenant } from "@/lib/tenant/resolver";
import { runWithTenant, type TenantContext } from "@/lib/tenant/context";

const { auth } = NextAuth(authConfig);

type AuthedRequest = NextRequest & { auth: { user?: { rol?: string } } | null };

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
    // Subdominio público: landing/registro/checkout/webhooks. No envuelve
    // con runWithTenant — su routing es global. La auth (login global) se
    // gestiona dentro del flow de auth de NextAuth aplicado por `auth()`.
    return appSubdomainHandler(req as AuthedRequest);
  }

  if (resolved.kind === "admin") {
    // Panel super-admin (Fase 7). Mientras llega:
    return new NextResponse("Panel super-admin pendiente (Fase 7)", {
      status: 503,
      headers: { "retry-after": "300" },
    });
  }

  if (resolved.kind === "invalid" || resolved.kind === "not_found") {
    // Mismo 404 indistinguible — anti-enumeración de subdominios.
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
    return new NextResponse(
      "Cuenta suspendida. Revisa la facturación.",
      { status: 402 },
    );
  }
  if (ctx.status === "deleted") {
    return new NextResponse("Cuenta eliminada", { status: 410 });
  }

  // status === "active": envolver con runWithTenant.
  return runWithTenant(ctx, () =>
    tenantSubdomainHandler(req as AuthedRequest, ctx),
  );
});

function appSubdomainHandler(req: AuthedRequest): NextResponse {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const isAuthPage = nextUrl.pathname.startsWith("/login");
  const isApiRoute = nextUrl.pathname.startsWith("/api");

  // El subdominio app sirve registro, checkout y webhooks. La lógica de
  // login en la landing global llegará en Fase 4. Por ahora redirige a
  // /registro como home.
  if (isApiRoute) return NextResponse.next();
  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }
  return NextResponse.next();
}

function tenantSubdomainHandler(
  req: AuthedRequest,
  _ctx: TenantContext,
): NextResponse {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const rol = req.auth?.user?.rol;

  const isAuthPage = nextUrl.pathname.startsWith("/login");
  const isSetupPage = nextUrl.pathname.startsWith("/setup");
  const isApiRoute = nextUrl.pathname.startsWith("/api");

  if (isApiRoute) return NextResponse.next();

  // /setup será retirado en Fase 4 cuando el flow de Stripe Checkout lo
  // sustituya. Hasta entonces se mantiene exonerado.
  if (isSetupPage) return NextResponse.next();

  if (!isLoggedIn && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  if (isLoggedIn && isAuthPage) {
    if (rol === "OWNER") return NextResponse.redirect(new URL("/admin", nextUrl));
    if (rol === "MANAGER") return NextResponse.redirect(new URL("/manager", nextUrl));
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
