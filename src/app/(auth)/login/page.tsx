import React from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { LogIn, AlertCircle } from "lucide-react";
import { resolveTenant } from "@/lib/tenant/resolver";
import { runWithTenant } from "@/lib/tenant/context";
import { ensureFeatureCatalogLoaded } from "@/lib/feature-guard/catalog";
import { EmpleaIALogo } from "@/components/brand/empleaia-logo";
import { GlobalLoginForm } from "./global-login-form";

export const dynamic = "force-dynamic";
// Sin cache cliente/SW — el HTML depende del subdominio (form del tenant
// vs global) y un cache stale entre subdominios sirve el form incorrecto.
export const fetchCache = "force-no-store";

// ─── Server action ────────────────────────────────────────────────────────────

async function loginAction(formData: FormData) {
  "use server";

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  // Destino absoluto al subdominio actual.
  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = host.includes("localhost") ? "http" : "https";
  const dest = `${proto}://${host}/`;

  // Sobreescribimos la cookie __Secure-authjs.callback-url ANTES de
  // signIn. Su valor por defecto lo setea NextAuth en el GET de /login
  // como NEXTAUTH_URL = https://app.empleaia.es, y es la causa del
  // rebote al subdominio app. Reescribirla con `dest` (subdominio
  // actual) hace que cualquier redirect interno de NextAuth se quede
  // en el tenant correcto.
  const cookieStore = await cookies();
  cookieStore.set("__Secure-authjs.callback-url", dest, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  // Variante sin Secure por si el cookie name del entorno es la no-secure.
  cookieStore.set("authjs.callback-url", dest, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  console.log("[loginAction] host=%s dest=%s email=%s", host, dest, email);

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
      redirectTo: dest,
    });
  } catch (error: any) {
    // NEXT_REDIRECT es un throw legítimo de Next — re-lanzar.
    if (error?.digest?.startsWith?.("NEXT_REDIRECT")) {
      throw error;
    }
    const code =
      error?.type ??
      error?.name ??
      (error?.message?.includes?.("credentialssignin") ? "CredentialsSignin" : null) ??
      "CredentialsSignin";
    // URL ABSOLUTA al subdominio actual para forzar hard navigation.
    // Un redirect relativo desde un server action genera soft navigation
    // que reusa el Router Cache cliente — y si la página /login fue
    // cacheada antes desde app.<root> (form global), sirve esa.
    redirect(`${proto}://${host}/login?error=${encodeURIComponent(code)}`);
  }

  console.log("[loginAction] redirecting to dest=%s", dest);
  redirect(dest);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface LoginPageProps {
  searchParams: Promise<{ error?: string; email?: string }>;
}

async function LoginPage({ searchParams }: LoginPageProps) {
  // Fase 4: el flow de "primer admin con /setup" se eliminó. El primer
  // OWNER se crea automáticamente desde el webhook checkout.session.completed
  // (commit 7 Fase 4) tras un registro real con Stripe.

  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  const { error, email: prefilledEmail } = await searchParams;
  // Mapeamos los códigos técnicos de NextAuth a mensajes humanos.
  // Si el error es un código conocido, lo traducimos; si no, lo mostramos
  // tal cual (es probable que ya venga decodificado del catch local).
  const ERROR_MESSAGES: Record<string, string> = {
    CredentialsSignin: "Email o contraseña incorrectos.",
    Configuration: "Error de configuración del servidor. Contacta con soporte.",
    AccessDenied: "Acceso denegado.",
    Verification: "El enlace ha expirado o ya se usó.",
    Default: "No se pudo iniciar sesión.",
  };
  const rawError = error ? decodeURIComponent(error) : null;
  const errorMessage = rawError
    ? ERROR_MESSAGES[rawError] ?? rawError
    : null;

  const branding = await prisma.configuracionEmpresa.findFirst({
    select: { logo: true, appNombre: true, nombre: true },
  }).catch(() => null);

  const appNombre = branding?.appNombre ?? "empleaIA";
  const empresa = branding?.nombre ?? appNombre;
  const logo = branding?.logo ?? null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      {/* Sutiles blobs de color en el fondo */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-60" />
        <div className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-50" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Logo + tagline arriba */}
        <div className="flex flex-col items-center mb-8">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt={empresa}
              className="h-12 max-w-[200px] object-contain mb-4"
            />
          ) : (
            <EmpleaIALogo appNombre={appNombre} symbolSize={40} className="mb-4" />
          )}
          <p className="text-sm text-slate-500">
            {empresa !== appNombre ? empresa : "Gestión inteligente de personal"}
          </p>
        </div>

        {/* Card formulario */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="px-8 py-8">
            <div className="mb-6 text-center">
              <h1 className="text-xl font-semibold text-slate-900">Iniciar sesión</h1>
              <p className="text-sm text-slate-500 mt-1">Accede a tu espacio de trabajo</p>
            </div>

            {errorMessage && (
              <div className="mb-5 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 animate-fade-in">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form action={loginAction} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-[var(--color-text-dark,#0F172A)] mb-1.5"
                >
                  Correo electrónico
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  defaultValue={prefilledEmail ?? ""}
                  placeholder="usuario@empresa.com"
                  className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3.5 py-2 text-sm text-[var(--color-text-dark,#0F172A)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-[var(--color-text-dark,#0F172A)] mb-1.5"
                >
                  Contraseña
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3.5 py-2 text-sm text-[var(--color-text-dark,#0F172A)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
                />
              </div>

              <button
                type="submit"
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] active:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30 focus-visible:ring-offset-1"
              >
                <LogIn className="h-4 w-4" />
                Iniciar sesión
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-slate-400">
              Acceso exclusivo para empleados de {empresa}.
            </p>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          {appNombre} &mdash; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

/**
 * `/login` se sirve desde 2 subdominios distintos con comportamiento
 * distinto:
 *   - <slug>.<root>/login   → form normal del tenant (LoginPage arriba).
 *   - app.<root>/login      → form global por email: pide email y
 *     redirige al subdominio del tenant donde existe ese usuario.
 */
export default async function LoginRoute(props: { searchParams: Promise<{ error?: string; email?: string }> }) {
  const h = await headers();
  const host = h.get("host") ?? "";
  const resolved = await resolveTenant(host);

  if (resolved.kind === "tenant" && resolved.ctx.status === "active") {
    return runWithTenant(resolved.ctx, async () => {
      await ensureFeatureCatalogLoaded();
      return LoginPage({ searchParams: props.searchParams });
    });
  }

  // Subdominios `app` y `apex` → login global con resolución por email.
  if (resolved.kind === "app" || resolved.kind === "apex") {
    const { email } = await props.searchParams;
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-60" />
          <div className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-50" />
        </div>
        <div className="relative w-full max-w-md animate-fade-in">
          <div className="flex flex-col items-center mb-8">
            <EmpleaIALogo appNombre="empleaIA" symbolSize={40} className="mb-4" />
            <p className="text-sm text-slate-500">Acceso a tu empresa</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
            <div className="px-8 py-8">
              <div className="mb-6 text-center">
                <h1 className="text-xl font-semibold text-slate-900">Iniciar sesión</h1>
                <p className="text-sm text-slate-500 mt-1">
                  Indica tu correo y te llevamos al panel de tu empresa.
                </p>
              </div>
              <GlobalLoginForm initialEmail={email ?? ""} />
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-slate-400">
            empleaIA &mdash; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    );
  }

  notFound();
}
