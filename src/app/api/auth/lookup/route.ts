/**
 * POST /api/auth/lookup — busca tenants donde existe un email.
 *
 * Lo usa el formulario de login global en app.<root>/login para
 * decidir a qué subdominio redirigir tras introducir el email.
 *
 * Devuelve `{ matches: [{ slug, empresa }] }` siempre, incluso si
 * vacío, para evitar revelar si el email existe (mismo timing).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { lookupTenantsByEmail } from "@/lib/auth/email-lookup";

const schema = z.object({
  email: z.string().email().max(200),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }
  const matches = await lookupTenantsByEmail(parsed.data.email);
  return NextResponse.json({ matches });
}
