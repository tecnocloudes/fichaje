/**
 * Wrapper de los handlers de NextAuth con reescritura de redirects.
 *
 * Bug observado: tras un POST exitoso a /api/auth/callback/credentials,
 * NextAuth devuelve 302 con Location absoluto basado en el host interno
 * del container (https://0.0.0.0:3000). Eso pasa porque NextAuth en
 * algunos paths construye la URL absoluta con `req.url` (que el server
 * Node ve como localhost:3000) en lugar de usar el Host header.
 *
 * Trustearle al Host header con `trustHost: true` y borrar NEXTAUTH_URL
 * no fue suficiente para este path concreto. La solución es reescribir
 * el Location en el response: si contiene `0.0.0.0:3000` o `localhost:3000`,
 * lo cambiamos por el host real del request (incluyendo protocolo).
 */

import { handlers } from "@/lib/auth";
import type { NextRequest } from "next/server";

const INTERNAL_HOSTS = ["0.0.0.0:3000", "0.0.0.0", "localhost:3000", "localhost"];

function realHost(req: NextRequest): { host: string; proto: string } {
  const host = req.headers.get("host") ?? new URL(req.url).host;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");
  return { host, proto };
}

function rewriteIfInternal(url: string, host: string, proto: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!INTERNAL_HOSTS.includes(parsed.host)) return null;
  return `${proto}://${host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function rewriteResponse(req: NextRequest, response: Response): Promise<Response> {
  const { host, proto } = realHost(req);

  // Reescribir Location header (redirects 30x).
  const loc = response.headers.get("location");
  const newLoc = loc ? rewriteIfInternal(loc, host, proto) : null;

  // Solo procesamos el body si es JSON (signOut, providers list, etc.).
  // Si no, devolvemos la response intacta — modificar el body de un
  // stream consumido o no-JSON rompe el cliente.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (!newLoc) return response;
    const newHeaders = new Headers(response.headers);
    newHeaders.set("location", newLoc);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  // JSON: lo leemos una sola vez.
  const originalText = await response.text();
  let bodyText = originalText;
  try {
    const data = JSON.parse(originalText) as Record<string, unknown>;
    if (typeof data.url === "string") {
      const rewrittenUrl = rewriteIfInternal(data.url, host, proto);
      if (rewrittenUrl) {
        data.url = rewrittenUrl;
        bodyText = JSON.stringify(data);
      }
    }
  } catch {
    // No JSON válido — dejar como está.
  }

  const newHeaders = new Headers(response.headers);
  if (newLoc) newHeaders.set("location", newLoc);
  // Quitar content-length para que el runtime lo recalcule según el body.
  newHeaders.delete("content-length");

  return new Response(bodyText, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export async function GET(req: NextRequest) {
  const r = await handlers.GET(req);
  return rewriteResponse(req, r);
}

export async function POST(req: NextRequest) {
  const r = await handlers.POST(req);
  return rewriteResponse(req, r);
}
