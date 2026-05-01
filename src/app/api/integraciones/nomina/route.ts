/**
 * GET/POST /api/integraciones/nomina — stub para integraciones de nómina.
 * Plan D.3.
 *
 * Provee shape estable de respuesta para que las UIs puedan iterar
 * mientras la implementación real (provider-specific: A3, Sage,
 * Holded, custom) llega en Fase 9.
 *
 * GET: devuelve los providers soportados (lista hardcoded) + estado
 *      actual de configuración del tenant ('not_configured' siempre).
 * POST: 501 not_implemented con detalle del provider esperado.
 */

import { auth } from "@/lib/auth";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const SUPPORTED_PROVIDERS = [
  { key: "a3", name: "A3 Nóminas (Wolters Kluwer)" },
  { key: "sage", name: "Sage Despachos / Sage 50c" },
  { key: "holded", name: "Holded" },
  { key: "custom", name: "Export CSV genérico" },
];

export const GET = withTenant(
  withFeature("integraciones_nomina", async () => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    return NextResponse.json({
      providers: SUPPORTED_PROVIDERS,
      currentConfig: null,
      status: "not_configured",
      note: "Integración real disponible en Fase 9. Solo CSV genérico funcional ahora.",
    });
  }),
);

export const POST = withTenant(
  withFeature("integraciones_nomina", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const body = (await req.json()) as { provider?: string };
    return NextResponse.json(
      {
        error: "not_implemented",
        provider: body.provider,
        eta: "Fase 9 — desarrollo por provider individual",
      },
      { status: 501 },
    );
  }),
);
