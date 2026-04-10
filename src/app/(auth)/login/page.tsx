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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-900 p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-indigo-600/5 blur-3xl" />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-md animate-fade-in">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
          {/* Top accent bar */}
          <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-violet-500" />

          <div className="px-8 py-10">
            {/* Logo + Branding */}
            <div className="flex flex-col items-center mb-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30 mb-4">
                <Building2 className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                TelecomFichaje
              </h1>
              <p className="text-sm text-indigo-300 mt-1">
                Sistema de fichaje de empleados
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
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:from-indigo-400 hover:to-violet-500 hover:shadow-indigo-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.98]"
              >
                <LogIn className="h-4 w-4" />
                Iniciar sesión
              </button>
            </form>

            {/* Footer note */}
            <p className="mt-8 text-center text-xs text-indigo-400/70">
              Acceso exclusivo para empleados de TelecomFichaje.
              <br />
              Si tienes problemas, contacta con tu manager.
            </p>
          </div>
        </div>

        {/* Version tag */}
        <p className="mt-4 text-center text-xs text-indigo-500/50">
          TelecomFichaje v1.0 &mdash; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
