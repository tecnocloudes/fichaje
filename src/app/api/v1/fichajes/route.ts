/**
 * GET /api/v1/fichajes — fichajes con filtros básicos.
 * Plan D.1.
 *
 * Query params:
 *  - userId, tiendaId (filtros).
 *  - desde, hasta (ISO 8601).
 *  - limit (cap 200), offset.
 */

import { type NextRequest, NextResponse } from "next/server";
import { prismaApp } from "@/lib/prisma";
import { withApiV1 } from "@/lib/api-v1/with-api-v1";

export const GET = withApiV1(async (req: NextRequest) => {
  const { searchParams } = req.nextUrl;
  const userId = searchParams.get("userId");
  const tiendaId = searchParams.get("tiendaId");
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const offset = Number(searchParams.get("offset") ?? 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (userId) where.userId = userId;
  if (tiendaId) where.tiendaId = tiendaId;
  if (desde || hasta) {
    where.timestamp = {};
    if (desde) where.timestamp.gte = new Date(desde);
    if (hasta) where.timestamp.lte = new Date(hasta);
  }

  const [data, count] = await Promise.all([
    prismaApp.fichaje.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        userId: true,
        tiendaId: true,
        tipo: true,
        timestamp: true,
        latitud: true,
        longitud: true,
      },
    }),
    prismaApp.fichaje.count({ where }),
  ]);
  return NextResponse.json({ data, count, limit, offset });
});
