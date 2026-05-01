/**
 * GET /api/v1/empleados — REST público, lista de empleados activos.
 * Plan D.1.
 */

import { NextResponse } from "next/server";
import { prismaApp } from "@/lib/prisma";
import { withApiV1 } from "@/lib/api-v1/with-api-v1";

export const GET = withApiV1(async () => {
  const empleados = await prismaApp.user.findMany({
    where: { activo: true },
    select: {
      id: true,
      email: true,
      nombre: true,
      apellidos: true,
      rol: true,
      tienda: { select: { id: true, nombre: true } },
    },
    orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
  });
  return NextResponse.json({ data: empleados, count: empleados.length });
});
