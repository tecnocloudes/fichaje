import React from "react";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Building2, LogIn, AlertCircle } from "lucide-react";

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

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // Redirect to setup if no users exist
  const userCount = await prisma.user.count();
  if (userCount === 0) redirect("/setup");

  // If already authenticated, redirect
  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  const { error } = await searchParams;
  const errorMessage = error ? decodeURIComponent(error) : null;

  // Branding
  const branding = await prisma.configuracionEmpresa.findFirst({
    select: { logo: true, appNombre: true, nombre: true, colorPrimario: true, colorSidebar: true },
  }).catch(() => null);

  const appNombre = branding?.appNombre ?? "TelecomFichaje";
  const empresa = branding?.nombre ?? appNombre;
  const colorPrimario = branding?.colorPrimario ?? "#6366f1";
  const colorSidebar = branding?.colorSidebar ?? "#1e1b4b";
  const logo = branding?.logo ?? null;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: `linear-gradient(135deg, ${colorSidebar} 0%, color-mix(in srgb, ${colorSidebar} 70%, ${colorPrimario}) 50%, color-mix(in srgb, ${colorPrimario} 60%, #7c3aed) 100%)`,
      }}
    >
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full blur-3xl" style={{ backgroundColor: `${colorPrimario}1a` }} />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full blur-3xl" style={{ backgroundColor: `${colorPrimario}1a` }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full blur-3xl" style={{ backgroundColor: `${colorPrimario}0d` }} />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-md animate-fade-in">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
          {/* Top accent bar with brand color */}
          <div className="h-1 w-full" style={{ background: `linear-gradient(to right, ${colorPrimario}, color-mix(in srgb, ${colorPrimario} 60%, #a78bfa))` }} />

          <div className="px-8 py-10">
            {/* Logo + Branding */}
            <div className="flex flex-col items-center mb-8">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  alt={empresa}
                  className="h-16 max-w-[180px] object-contain mb-4 drop-shadow-lg"
                />
              ) : (
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg mb-4"
                  style={{
                    background: `linear-gradient(135deg, ${colorPrimario}, color-mix(in srgb, ${colorPrimario} 60%, #7c3aed))`,
                    boxShadow: `0 8px 24px ${colorPrimario}4d`,
                  }}
                >
                  <Building2 className="h-8 w-8 text-white" />
                </div>
              )}
              <h1 className="text-2xl font-bold text-white tracking-tight">
                {appNombre}
              </h1>
              <p className="text-sm text-white/50 mt-1">
                {empresa !== appNombre ? empresa : "Sistema de gestión de empleados"}
              </p>
            </div>

            {/* Error message */}
            {errorMessage && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 animate-fade-in">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Login form */}
            <form action={loginAction} className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-indigo-200 mb-1.5"
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
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-indigo-400/60 shadow-sm backdrop-blur-sm transition-colors focus:border-indigo-400 focus:bg-white/15 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-indigo-200 mb-1.5"
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
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-indigo-400/60 shadow-sm backdrop-blur-sm transition-colors focus:border-indigo-400 focus:bg-white/15 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <button
                type="submit"
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.98]"
                style={{
                  background: `linear-gradient(to right, ${colorPrimario}, color-mix(in srgb, ${colorPrimario} 60%, #7c3aed))`,
                  boxShadow: `0 4px 16px ${colorPrimario}4d`,
                }}
              >
                <LogIn className="h-4 w-4" />
                Iniciar sesión
              </button>
            </form>

            {/* Footer note */}
            <p className="mt-8 text-center text-xs text-white/40">
              Acceso exclusivo para empleados de {empresa}.
              <br />
              Si tienes problemas, contacta con tu manager.
            </p>
          </div>
        </div>

        {/* Version tag */}
        <p className="mt-4 text-center text-xs text-white/25">
          {appNombre} &mdash; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
