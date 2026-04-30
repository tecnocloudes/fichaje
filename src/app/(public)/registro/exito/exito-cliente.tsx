"use client";

import { useEffect, useState } from "react";

type Status = "pending" | "provisioning" | "active" | "error" | "unknown";

export function ExitoCliente({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<Status>("pending");
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const r = await fetch(
          `/api/onboarding/status?session_id=${encodeURIComponent(sessionId)}`,
          { cache: "no-store" },
        );
        if (!r.ok) {
          if (!stopped) setStatus("error");
          return;
        }
        const body = (await r.json()) as { status: Status; slug?: string };
        if (stopped) return;
        setStatus(body.status);
        if (body.slug) setTenantSlug(body.slug);
        if (body.status === "active") {
          // Redirigir al subdominio del tenant.
          if (body.slug) {
            const root = window.location.host.split(".").slice(1).join(".");
            const port = window.location.port ? `:${window.location.port}` : "";
            const protocol = window.location.protocol;
            const target = `${protocol}//${body.slug}.${root || window.location.host}${port}/login`;
            window.location.href = target;
          }
          return;
        }
        // Reintentar en 2s.
        timer = setTimeout(poll, 2000);
      } catch {
        if (!stopped) setStatus("error");
      }
    }

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  return (
    <main
      style={{
        maxWidth: 600,
        margin: "0 auto",
        padding: 32,
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 28 }}>Estamos preparando tu cuenta</h1>
      {status === "pending" || status === "provisioning" ? (
        <>
          <div
            style={{
              margin: "32px auto",
              width: 40,
              height: 40,
              border: "4px solid #e5e7eb",
              borderTopColor: "#6366f1",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <p>Esto suele tardar entre 5 y 15 segundos. No cierres esta página.</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      ) : status === "active" ? (
        <p>
          Cuenta lista. Redirigiendo a <strong>{tenantSlug}</strong>…
        </p>
      ) : (
        <p style={{ color: "#dc2626" }}>
          Hubo un problema preparando tu cuenta. Recibirás un email cuando esté
          lista, o contacta con soporte si no te llega en 1 hora.
        </p>
      )}
    </main>
  );
}
