"use client";

import React, { useState, Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, Shuffle, Copy, Check } from "lucide-react";

interface Branding {
  logo: string | null;
  appNombre: string;
  colorPrimario: string;
  colorSidebar: string;
}

function generatePassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*()-_=+[]{}|;:,.<>?";
  const all = upper + lower + digits + symbols;

  // Garantizar al menos uno de cada tipo
  const required = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  const rest = Array.from({ length: 28 }, () => all[Math.floor(Math.random() * all.length)]);
  const combined = [...required, ...rest];

  // Barajar
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join("");
}

function SetPasswordForm({ branding }: { branding: Branding }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = () => {
    const pwd = generatePassword();
    setPassword(pwd);
    setConfirm(pwd);
    setGenerated(true);
    setShowPwd(true);
    setError(null);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    if (!generated && password !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setDone(true);
      setTimeout(() => router.replace("/login"), 3000);
    } catch (e: any) {
      setError(e.message || "Error al establecer la contraseña");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-indigo-400/60 shadow-sm backdrop-blur-sm transition-colors focus:border-indigo-400 focus:bg-white/15 focus:outline-none focus:ring-2 focus:ring-indigo-500/30";

  if (!token) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>Enlace no válido. Contacta con tu administrador.</span>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
          <CheckCircle2 className="h-8 w-8 text-green-400" />
        </div>
        <div className="text-center">
          <p className="text-white font-semibold text-lg">¡Contraseña creada!</p>
          <p className="text-white/60 text-sm mt-1">Redirigiendo al inicio de sesión...</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Campo contraseña */}
      <div>
        <label className="block text-sm font-medium text-indigo-200 mb-1.5">
          Nueva contraseña
        </label>
        <div className="relative">
          <input
            type={showPwd ? "text" : "password"}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setGenerated(false); }}
            required
            minLength={6}
            placeholder="Mínimo 6 caracteres"
            className={`${inputClass} pr-10 font-mono`}
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
          >
            {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Confirmar — solo si no es generada */}
      {!generated && (
        <div>
          <label className="block text-sm font-medium text-indigo-200 mb-1.5">
            Confirmar contraseña
          </label>
          <input
            type={showPwd ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            placeholder="Repite la contraseña"
            className={`${inputClass} font-mono`}
          />
        </div>
      )}

      {/* Acciones: generar + copiar */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-indigo-200 transition-all hover:bg-white/10 hover:text-white"
        >
          <Shuffle className="h-4 w-4" />
          Generar contraseña
        </button>

        {password && (
          <button
            type="button"
            onClick={handleCopy}
            className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
              copied
                ? "border-green-500/40 bg-green-500/10 text-green-300"
                : "border-white/15 bg-white/5 text-indigo-200 hover:bg-white/10 hover:text-white"
            }`}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiada" : "Copiar"}
          </button>
        )}
      </div>

      {generated && (
        <p className="text-xs text-indigo-300/70 text-center -mt-1">
          Contraseña generada automáticamente — cópiala antes de continuar
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-indigo-500 focus:outline-none active:scale-[0.98] disabled:opacity-60"
      >
        <KeyRound className="h-4 w-4" />
        {loading ? "Guardando..." : "Establecer contraseña"}
      </button>
    </form>
  );
}

function SetPasswordPageInner() {
  const [branding, setBranding] = useState<Branding>({
    logo: null,
    appNombre: "HR Suite",
    colorPrimario: "#6366f1",
    colorSidebar: "#1e1b4b",
  });

  useEffect(() => {
    fetch("/api/configuracion/branding")
      .then((r) => r.json())
      .then((d) => setBranding(d))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#4c1d95]">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
          <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-purple-500" />

          <div className="px-8 py-10">
            <div className="flex flex-col items-center mb-8">
              {branding.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.logo}
                  alt={branding.appNombre}
                  className="h-16 max-w-[200px] object-contain mb-4"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg mb-4 text-white font-bold text-xl">
                  {branding.appNombre.charAt(0).toUpperCase()}
                </div>
              )}
              <h1 className="text-2xl font-bold text-white tracking-tight">Crea tu contraseña</h1>
              <p className="text-sm text-white/50 mt-1">Activa tu cuenta para acceder a la plataforma</p>
            </div>

            <Suspense fallback={<div className="text-white/50 text-sm text-center">Cargando...</div>}>
              <SetPasswordForm branding={branding} />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#4c1d95]" />}>
      <SetPasswordPageInner />
    </Suspense>
  );
}
