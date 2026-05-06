"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Plus, MessageSquare, Trash2 } from "lucide-react";

interface Conversacion {
  id: string;
  titulo: string;
  updatedAt: string | Date;
}

interface Mensaje {
  id: string;
  rol: string;
  contenido: string;
  errorMsg?: string | null;
  createdAt?: string | Date;
}

interface Props {
  conversaciones: Conversacion[];
  provider: string;
  modelo: string;
}

export function ChatLayout({ conversaciones: initial, provider, modelo }: Props) {
  const [conversaciones, setConversaciones] = useState<Conversacion[]>(initial);
  const [activaId, setActivaId] = useState<string | null>(initial[0]?.id ?? null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Cargar mensajes al cambiar de conversación.
  useEffect(() => {
    if (!activaId) {
      setMensajes([]);
      return;
    }
    let stopped = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/ia/conversaciones/${activaId}`);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const data = await r.json();
        if (!stopped) setMensajes((data.conversacion?.mensajes ?? []) as Mensaje[]);
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [activaId]);

  // Auto-scroll al fondo cuando llegan mensajes.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mensajes, sending]);

  async function nuevaConversacion() {
    setError(null);
    try {
      const r = await fetch("/api/ia/conversaciones", { method: "POST" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      const nueva = data.conversacion as Conversacion;
      setConversaciones((cs) => [nueva, ...cs]);
      setActivaId(nueva.id);
      setMensajes([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  async function borrarConversacion(id: string) {
    if (!confirm("¿Borrar esta conversación?")) return;
    try {
      await fetch(`/api/ia/conversaciones/${id}`, { method: "DELETE" });
      setConversaciones((cs) => cs.filter((c) => c.id !== id));
      if (activaId === id) {
        setActivaId(null);
        setMensajes([]);
      }
    } catch {
      // silent
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    let convId = activaId;
    // Si no hay conversación activa, crear una primero.
    if (!convId) {
      const r = await fetch("/api/ia/conversaciones", { method: "POST" });
      if (!r.ok) {
        setError("Error creando conversación");
        return;
      }
      const data = await r.json();
      convId = (data.conversacion as Conversacion).id;
      setConversaciones((cs) => [data.conversacion, ...cs]);
      setActivaId(convId);
    }

    const tempUserMsg: Mensaje = {
      id: `tmp_${Date.now()}`,
      rol: "user",
      contenido: input,
    };
    setMensajes((ms) => [...ms, tempUserMsg]);
    const enviado = input;
    setInput("");
    setSending(true);
    setError(null);

    try {
      const r = await fetch(`/api/ia/conversaciones/${convId}/mensajes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contenido: enviado }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error ?? `HTTP ${r.status}`);
      }
      // Reemplaza el temp por los reales.
      setMensajes((ms) => {
        const sinTemp = ms.filter((m) => m.id !== tempUserMsg.id);
        const nuevos: Mensaje[] = [];
        if (data.userMsg) nuevos.push(data.userMsg);
        if (data.assistantMsg) nuevos.push(data.assistantMsg);
        return [...sinTemp, ...nuevos];
      });
      // Refrescar título en sidebar.
      if (data.userMsg) {
        setConversaciones((cs) => {
          const c = cs.find((x) => x.id === convId);
          if (!c) return cs;
          const titulo = c.titulo === "Nueva conversación"
            ? enviado.slice(0, 60)
            : c.titulo;
          return [
            { ...c, titulo, updatedAt: new Date().toISOString() },
            ...cs.filter((x) => x.id !== convId),
          ];
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[500px]">
      {/* Sidebar conversaciones */}
      <aside className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white flex flex-col overflow-hidden">
        <button
          onClick={nuevaConversacion}
          className="m-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          Nueva conversación
        </button>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
          {conversaciones.length === 0 ? (
            <p className="px-2 py-4 text-xs text-slate-400 text-center">Sin conversaciones todavía</p>
          ) : (
            conversaciones.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-md hover:bg-slate-50 ${activaId === c.id ? "bg-[var(--primary)]/5" : ""}`}
              >
                <button
                  onClick={() => setActivaId(c.id)}
                  className="flex-1 min-w-0 flex items-center gap-2 px-2 py-2 text-sm text-left"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{c.titulo}</span>
                </button>
                <button
                  onClick={() => borrarConversacion(c.id)}
                  className="opacity-0 group-hover:opacity-100 mr-1 p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-700"
                  aria-label="Borrar"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
        <p className="px-3 py-2 border-t text-[11px] text-slate-400">
          {provider} · {modelo}
        </p>
      </aside>

      {/* Área de chat */}
      <section className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}
          {!loading && mensajes.length === 0 && (
            <div className="text-center py-12 text-sm text-slate-400">
              Pregúntame algo. Por ejemplo:
              <ul className="mt-3 space-y-1.5 text-slate-600">
                <li>&quot;Redacta un comunicado anunciando el cierre por puente&quot;</li>
                <li>&quot;Dame 5 preguntas para una entrevista de Backend&quot;</li>
                <li>&quot;Resume estos datos de absentismo: …&quot;</li>
              </ul>
            </div>
          )}
          {mensajes.map((m) => (
            <MensajeBubble key={m.id} mensaje={m} />
          ))}
          {sending && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Pensando…
            </div>
          )}
          {error && (
            <div className="px-3 py-2 text-sm rounded-md border border-red-200 bg-red-50 text-red-800">
              {error}
            </div>
          )}
        </div>
        <form onSubmit={enviar} className="border-t bg-slate-50 p-3 flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar(e as unknown as React.FormEvent);
              }
            }}
            rows={2}
            placeholder="Escribe tu mensaje. Enter para enviar, Shift+Enter para salto de línea."
            className="flex-1 rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 resize-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </button>
        </form>
      </section>
    </div>
  );
}

function MensajeBubble({ mensaje }: { mensaje: Mensaje }) {
  const isUser = mensaje.rol === "user";
  const hasError = !!mensaje.errorMsg;
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
          isUser
            ? "bg-[var(--primary)] text-white"
            : hasError
              ? "bg-red-50 border border-red-200 text-red-900"
              : "bg-slate-100 text-slate-900"
        }`}
      >
        {mensaje.contenido}
      </div>
    </div>
  );
}
