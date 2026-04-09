import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TipoFichaje } from "@/generated/prisma/client";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userId = session.user.id;

    // Get the last fichaje to determine current state
    const ultimoFichaje = await prisma.fichaje.findFirst({
      where: { userId },
      orderBy: { timestamp: "desc" },
      include: {
        tienda: { select: { id: true, nombre: true } },
      },
    });

    const estaFichado =
      ultimoFichaje !== null &&
      ultimoFichaje.tipo !== TipoFichaje.SALIDA;

    const enPausa = ultimoFichaje?.tipo === TipoFichaje.PAUSA;

    // Find today's ENTRADA to calculate horaEntrada and minutosHoy
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    const fichajesHoy = await prisma.fichaje.findMany({
      where: {
        userId,
        timestamp: { gte: hoy, lt: manana },
      },
      orderBy: { timestamp: "asc" },
    });

    // Find the last ENTRADA of today
    const entradaHoy = fichajesHoy
      .slice()
      .reverse()
      .find((f) => f.tipo === TipoFichaje.ENTRADA);

    const horaEntrada = entradaHoy?.timestamp ?? null;

    // Calculate minutes worked today (sum of active periods)
    let minutosHoy = 0;
    let periodoInicio: Date | null = null;

    for (const fichaje of fichajesHoy) {
      if (fichaje.tipo === TipoFichaje.ENTRADA || fichaje.tipo === TipoFichaje.VUELTA_PAUSA) {
        periodoInicio = fichaje.timestamp;
      } else if (
        (fichaje.tipo === TipoFichaje.PAUSA || fichaje.tipo === TipoFichaje.SALIDA) &&
        periodoInicio !== null
      ) {
        minutosHoy += Math.floor(
          (fichaje.timestamp.getTime() - periodoInicio.getTime()) / 60000
        );
        periodoInicio = null;
      }
    }

    // If still active (no SALIDA), count time until now
    if (periodoInicio !== null && estaFichado && !enPausa) {
      minutosHoy += Math.floor(
        (new Date().getTime() - periodoInicio.getTime()) / 60000
      );
    }

    return Response.json({
      ultimoFichaje,
      estaFichado,
      enPausa,
      horaEntrada,
      minutosHoy,
    });
  } catch (error) {
    console.error("GET /api/fichajes/estado error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
