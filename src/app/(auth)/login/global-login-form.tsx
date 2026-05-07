"use client";

import { useState } from "react";
import { Loader2, Mail, ArrowRight, Building2, AlertCircle } from "lucide-react";

interface TenantMatch {
  slug: string;
  empresa: string;
}

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white pl-10 pr-3.5 py-2 text-sm placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors";

export function GlobalLoginForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<TenantMatch[] | null>(null);

  function rootDomain(): string {
    if (typeof window === "undefined") return "empleaia.es";
    const parts = window.location.host.split(":")[0]!.split(".");
    // Quitamos el primer subdominio (app, apex se trata como vacío)
    if (parts.length >= 2) return parts.slice(-2).join(".");
    return parts.join(".");
  }

  function redirectTo(slug: string) {
    const root = rootDomain();
    const proto = window.location.protocol;
    const port = window.location.port ? `:${window.location.port}` : "";
    window.location.href = `${proto}//${slug}.${root}${port}/login?email=${encodeURIComponent(email)}`;
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email) return;
    setPending(true);
    setError(null);
    setMatches(null);
    try {
      const r = await fetch("/api/auth/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      const ms = (data.matches ?? []) as TenantMatch[];
      if (ms.length === 0) {
        setError(
          "No encontramos ninguna cuenta con ese correo. Comprueba que es el email que usaste para registrarte o contacta con tu administrador.",
        );
      } else if (ms.length === 1) {
        redirectTo(ms[0].slug);
      } else {
        setMatches(ms);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setPending(false);
    }
  }

  if (matches) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-700">
          Tu correo <strong>{email}</strong> está registrado en varias empresas. Elige una para continuar:
        </p>
        <ul className="space-y-2">
          {matches.map((m) => (
            <li key={m.slug}>
              <button
                onClick={() => redirectTo(m.slug)}
                className="w-full flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-4 py-3 hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-[var(--primary)]" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">{m.empresa}</p>
                    <p className="text-xs text-slate-500">{m.slug}.empleaia.es</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => {
            setMatches(null);
            setError(null);
          }}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Usar otro correo
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
          Correo electrónico
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            placeholder="usuario@empresa.com"
            className={INPUT}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending || !email}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        Continuar
      </button>

      <p className="text-center text-xs text-slate-400">
        ¿Aún no tienes cuenta?{" "}
        <a href="/registro" className="text-[var(--primary)] hover:underline">
          Crear empresa
        </a>
      </p>
    </form>
  );
}
