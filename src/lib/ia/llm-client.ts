/**
 * Cliente LLM agnóstico al proveedor (BYOK — Bring Your Own Key).
 *
 * Soporta:
 *   - anthropic — POST https://api.anthropic.com/v1/messages
 *   - openai    — POST https://api.openai.com/v1/chat/completions
 *   - google    — POST https://generativelanguage.googleapis.com/v1beta/models/<modelo>:generateContent
 *
 * Cada tenant configura su propia API key (cifrada en BD). Esta capa
 * normaliza la entrada (mensajes formato OpenAI) y la salida (texto +
 * tokens) para que el resto del código no tenga que diferenciar.
 *
 * Sin SDK oficial — usamos fetch directo para evitar añadir dependencias
 * pesadas (cada SDK pesa varios MB).
 */

import type { ProveedorIA } from "@/generated/prisma-tenant/client";

export interface ChatMessage {
  rol: "system" | "user" | "assistant";
  contenido: string;
}

export interface ChatResult {
  contenido: string;
  tokensInput: number;
  tokensOutput: number;
  modelo: string;
  raw?: unknown;
}

export interface LlmConfig {
  provider: ProveedorIA;
  apiKey: string;
  modelo: string;
  endpointUrl?: string | null;
  maxTokensRespuesta?: number;
}

const TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 2000;

export async function chat(
  config: LlmConfig,
  messages: ChatMessage[],
): Promise<ChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    switch (config.provider) {
      case "anthropic":
        return await chatAnthropic(config, messages, ctrl.signal);
      case "openai":
        return await chatOpenAI(config, messages, ctrl.signal);
      case "google":
        return await chatGoogle(config, messages, ctrl.signal);
      default: {
        const _: never = config.provider;
        throw new Error(`Proveedor IA desconocido: ${_ as string}`);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verificación ligera de que la API key es válida — pide un mensaje
 * mínimo. Usado por el form de configuración con un botón "Probar conexión".
 */
export async function ping(config: LlmConfig): Promise<{ ok: true; modelo: string } | { ok: false; error: string }> {
  try {
    const r = await chat(config, [
      { rol: "user", contenido: 'Responde "OK" sin nada más.' },
    ]);
    return { ok: true, modelo: r.modelo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Anthropic ─────────────────────────────────────────────────────────────────

async function chatAnthropic(
  config: LlmConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<ChatResult> {
  const url = config.endpointUrl?.replace(/\/$/, "") ?? "https://api.anthropic.com";
  const systemMsg = messages.find((m) => m.rol === "system");
  const others = messages.filter((m) => m.rol !== "system");
  const body = {
    model: config.modelo,
    max_tokens: config.maxTokensRespuesta ?? DEFAULT_MAX_TOKENS,
    system: systemMsg?.contenido ?? undefined,
    messages: others.map((m) => ({
      role: m.rol,
      content: m.contenido,
    })),
  };
  const r = await fetch(`${url}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
    model: string;
  };
  const text = data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return {
    contenido: text,
    tokensInput: data.usage.input_tokens,
    tokensOutput: data.usage.output_tokens,
    modelo: data.model,
    raw: data,
  };
}

// ─── OpenAI ────────────────────────────────────────────────────────────────────

async function chatOpenAI(
  config: LlmConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<ChatResult> {
  const url = config.endpointUrl?.replace(/\/$/, "") ?? "https://api.openai.com";
  const body = {
    model: config.modelo,
    max_tokens: config.maxTokensRespuesta ?? DEFAULT_MAX_TOKENS,
    messages: messages.map((m) => ({
      role: m.rol,
      content: m.contenido,
    })),
  };
  const r = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
    model: string;
  };
  const text = data.choices[0]?.message.content ?? "";
  return {
    contenido: text,
    tokensInput: data.usage.prompt_tokens,
    tokensOutput: data.usage.completion_tokens,
    modelo: data.model,
    raw: data,
  };
}

// ─── Google Gemini ─────────────────────────────────────────────────────────────

async function chatGoogle(
  config: LlmConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<ChatResult> {
  const url = config.endpointUrl?.replace(/\/$/, "") ?? "https://generativelanguage.googleapis.com";
  // Google maneja system instructions aparte y messages como `contents`.
  const systemMsg = messages.find((m) => m.rol === "system");
  const others = messages.filter((m) => m.rol !== "system");
  const body = {
    systemInstruction: systemMsg
      ? { parts: [{ text: systemMsg.contenido }] }
      : undefined,
    contents: others.map((m) => ({
      role: m.rol === "assistant" ? "model" : "user",
      parts: [{ text: m.contenido }],
    })),
    generationConfig: {
      maxOutputTokens: config.maxTokensRespuesta ?? DEFAULT_MAX_TOKENS,
    },
  };
  const r = await fetch(
    `${url}/v1beta/models/${config.modelo}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (!r.ok) throw new Error(`Google ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as {
    candidates?: Array<{ content?: { parts: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    modelVersion?: string;
  };
  const text =
    data.candidates?.[0]?.content?.parts.map((p) => p.text ?? "").join("") ??
    "";
  return {
    contenido: text,
    tokensInput: data.usageMetadata?.promptTokenCount ?? 0,
    tokensOutput: data.usageMetadata?.candidatesTokenCount ?? 0,
    modelo: data.modelVersion ?? config.modelo,
    raw: data,
  };
}
