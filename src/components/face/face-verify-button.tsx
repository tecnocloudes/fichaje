"use client";

import { useEffect, useState } from "react";
import { Loader2, ScanFace, X } from "lucide-react";
import { FaceCapture } from "./face-capture";

/**
 * Botón "Fichar con Face ID" que muestra un modal con captura facial.
 * Si el usuario no tiene template registrada (FaceTemplate), no se
 * muestra. Si tiene, captura → POST /api/face/verify → si match,
 * llama al callback `onVerified()` para que el padre ejecute el
 * fichaje normal.
 */

interface Props {
  onVerified: () => void | Promise<void>;
  /** Texto descriptivo de la acción (ej. "Fichar entrada"). */
  label: string;
  disabled?: boolean;
}

export function FaceVerifyButton({ onVerified, label, disabled }: Props) {
  const [hasTemplate, setHasTemplate] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    fetch("/api/face/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!stopped) setHasTemplate(!!data?.hasTemplate);
      })
      .catch(() => {
        if (!stopped) setHasTemplate(false);
      });
    return () => {
      stopped = true;
    };
  }, []);

  if (hasTemplate === null || hasTemplate === false) return null;

  async function verify(embedding: number[]) {
    setPending(true);
    setError(null);
    try {
      const r = await fetch("/api/face/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embedding }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      if (!data.match) {
        const score = (data.score ?? 0).toFixed(2);
        const threshold = (data.threshold ?? 0.6).toFixed(2);
        throw new Error(
          `No coincide con tu rostro registrado (similitud ${score}, mínimo ${threshold}).`,
        );
      }
      // Match → ejecutar el fichaje real.
      await onVerified();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-white hover:bg-[var(--primary)]/5 px-3 py-2 text-sm font-medium text-[var(--primary)] disabled:opacity-50"
      >
        <ScanFace className="h-4 w-4" />
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between">
              <h2 className="font-semibold text-lg">Verificar identidad</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <FaceCapture
              cta="Capturar"
              pending={pending}
              onCapture={(emb) => void verify(emb)}
            />
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            )}
            {pending && (
              <div className="text-center text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin inline-block mr-1" />
                Verificando…
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
