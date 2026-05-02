import React from "react";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { LogIn, AlertCircle } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { EmpleaIALogo } from "@/components/brand/empleaia-logo";

export const dynamic = "force-dynamic";

// ─── Server action ────────────────────────────────────────────────────────────

async function loginAction(formData: FormData) {
  "use server";

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch (error: any) {
    const message =
      error?.cause?.err?.message ??
      error?.message ??
      "Credenciales incorrectas";

    const encoded = encodeURIComponent(message);
    redirect(`/login?error=${encoded}`);
  }

  redirect("/");
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

async function LoginPage({ searchParams }: LoginPageProps) {
  // Fase 4: el flow de "primer admin con /setup" se eliminó. El primer
  // OWNER se crea automáticamente desde el webhook checkout.session.completed
  // (commit 7 Fase 4) tras un registro real con Stripe.

  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  const { error } = await searchParams;
  const errorMessage = error ? decodeURIComponent(error) : null;

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
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Correo electrónico
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="usuario@empresa.com"
                  className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
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
                  className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
                />
              </div>

              <button
                type="submit"
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] hover:bg-[var(--primary-dark)] active:bg-[var(--primary-dark)] px-5 py-2.5 text-base font-medium text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 focus-visible:ring-offset-1"
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

export default withTenantPage(LoginPage as never);
