/**
 * GET/POST /api/webhooks-tenant — gestión de webhooks outbound del tenant.
 * Plan D.5.
 *
 * El secret HMAC se devuelve plain solo en el POST inicial. Después
 * solo se exponen prefijos para identificación.
 *
 * El disparo real de webhooks (event handlers que invocan los URLs)
 * se implementa en Fase 9 — aquí solo el CRUD.
 */

import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { randomBytes } from "node:crypto";

export const GET = withTenant(
  withFeature("webhooks", async () => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const webhooks = await prismaApp.tenantWebhook.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        lastFiredAt: true,
        failCount: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ webhooks });
  }),
);

export const POST = withTenant(
  withFeature("webhooks", async (req: NextRequest) => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user || user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const body = (await req.json()) as { url?: string; events?: string[] };
    if (!body.url || !Array.isArray(body.events) || body.events.length === 0) {
      return NextResponse.json(
        { error: "missing_fields", required: ["url", "events[]"] },
        { status: 400 },
      );
    }
    if (!/^https:\/\//.test(body.url)) {
      return NextResponse.json(
        { error: "url_must_be_https" },
        { status: 400 },
      );
    }
    const secret = randomBytes(32).toString("hex");
    const created = await prismaApp.tenantWebhook.create({
      data: {
        url: body.url,
        events: body.events,
        secret, // por ahora plain; bcrypt al equiparar Fase 9 cuando
        // se implemente disparo + verificación HMAC.
      },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        createdAt: true,
      },
    });
    return NextResponse.json(
      { ...created, secretPlain: secret },
      { status: 201 },
    );
  }),
);
