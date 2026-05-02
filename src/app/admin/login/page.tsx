"use client";

/**
 * /admin/login — login del panel super-admin.
 * Form mínimo funcional: email + password → POST /api/admin/login.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (r.ok) {
        router.push("/admin/dashboard");
        router.refresh();
        return;
      }
      const body = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setError("Credenciales incorrectas");
      } else {
        setError(body?.error ?? `Error ${r.status}`);
      }
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="relative w-full max-w-md">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-8 py-8">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold text-slate-900">Acceso super-admin</h1>
            <p className="text-sm text-slate-500 mt-1">Panel interno empleaIA</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20"
                required
                autoComplete="username"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20"
                required
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 hover:bg-slate-800 text-white py-2.5 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
