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

function rewriteLocation(req: NextRequest, response: Response): Response {
  const loc = response.headers.get("location");
  if (!loc) return response;
  let parsed: URL;
  try {
    parsed = new URL(loc);
  } catch {
    return response;
  }
  if (!INTERNAL_HOSTS.includes(parsed.host)) return response;

  // Reconstruir Location con el host real del request.
  const host = req.headers.get("host") ?? new URL(req.url).host;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");
  const newLoc = `${proto}://${host}${parsed.pathname}${parsed.search}${parsed.hash}`;

  // Clonamos los headers, reemplazamos Location.
  const newHeaders = new Headers(response.headers);
  newHeaders.set("location", newLoc);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export async function GET(req: NextRequest) {
  const r = await handlers.GET(req);
  return rewriteLocation(req, r);
}

export async function POST(req: NextRequest) {
  const r = await handlers.POST(req);
  return rewriteLocation(req, r);
}
