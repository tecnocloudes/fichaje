/**
 * GET /api/v1/tiendas — lista de sedes activas.
 * Plan D.1.
 */

import { NextResponse } from "next/server";
import { prismaApp } from "@/lib/prisma";
import { withApiV1 } from "@/lib/api-v1/with-api-v1";

export const GET = withApiV1(async () => {
  const tiendas = await prismaApp.tienda.findMany({
    where: { activa: true },
    select: {
      id: true,
      nombre: true,
      direccion: true,
      ciudad: true,
      latitud: true,
      longitud: true,
    },
    orderBy: { nombre: "asc" },
  });
  return NextResponse.json({ data: tiendas, count: tiendas.length });
});
