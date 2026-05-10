import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { TipoFichaje, MetodoFichaje, Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { getLimit, hasFeature } from "@/lib/tenant/features";
import { runMigrations } from "@/lib/migrate";
import { detectDeviceTypeFromUA } from "@/lib/device-ua";
import { encrypt } from "@/lib/crypto/aes-gcm";
export const GET = withTenant(async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const tiendaId = searchParams.get("tiendaId");
    const userId = searchParams.get("userId");
    const fecha = searchParams.get("fecha");

    const userRol = (session.user as any).rol as Rol;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    // Build where clause based on role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (userRol === Rol.OWNER) {
      if (tiendaId) where.tiendaId = tiendaId;
      if (userId) where.userId = userId;
    } else if (userRol === Rol.MANAGER) {
      where.tiendaId = userTiendaId;
      if (userId) where.userId = userId;
    } else {
      // EMPLEADO
      where.userId = session.user.id;
    }

    if (fecha) {
      const start = new Date(fecha);
      start.setHours(0, 0, 0, 0);
      const end = new Date(fecha);
      end.setHours(23, 59, 59, 999);
      where.timestamp = { gte: start, lte: end };
    } else {
      // Plan Fase 5 §5.1 + coverage: historial_meses limit. El plan
      // starter expone 6 meses, pro 36, enterprise null (sin límite).
      // Si limit es null o falta loader, no filtrar.
      const meses = getLimit("historial_meses");
      if (meses !== null && meses > 0) {
        const horizon = new Date();
        horizon.setMonth(horizon.getMonth() - meses);
        where.timestamp = { ...(where.timestamp ?? {}), gte: horizon };
      }
    }

    const fichajes = await prisma.fichaje.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            nombre: true,
            apellidos: true,
            email: true,
          },
        },
        tienda: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
      orderBy: { timestamp: "desc" },
    });

    return Response.json(fichajes);
  } catch (error) {
    console.error("GET /api/fichajes error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const POST = withTenant(async (request: NextRequest) => {
  try {
    await runMigrations();

    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const {
      tipo,
      latitud,
      longitud,
      distancia,
      metodo = MetodoFichaje.WEB,
      nota,
      faceVerified,
      fotoSnapshot,
    } = body as {
      tipo: TipoFichaje;
      latitud?: number;
      longitud?: number;
      distancia?: number;
      metodo?: MetodoFichaje;
      nota?: string;
      faceVerified?: boolean;
      /** Data URL JPEG ≤200 KB. Solo se guarda si el tenant lo activó. */
      fotoSnapshot?: string;
    };

    if (!tipo || !Object.values(TipoFichaje).includes(tipo)) {
      return Response.json({ error: "Tipo de fichaje inválido" }, { status: 400 });
    }

    const userId = session.user.id;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    // Get the last fichaje to validate state transitions
    const ultimoFichaje = await prisma.fichaje.findFirst({
      where: { userId },
      orderBy: { timestamp: "desc" },
    });

    const ultimoTipo = ultimoFichaje?.tipo ?? null;

    // Validate state transitions
    const validationError = validateTipoFichaje(tipo, ultimoTipo);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    // Get IP from headers
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0].trim() : null;

    // Plan Fase 5 §5.1: geofencing es CORE-safe — NUNCA rechaza el
    // fichaje (RD 8/2019). Solo controla si registramos lat/lon y
    // distancia para auditoría. Sin la feature, descartamos los
    // datos de geolocalización aunque el cliente los envíe.
    const geofencingActivo = hasFeature("geofencing");
    const lat = geofencingActivo ? latitud : null;
    const lon = geofencingActivo ? longitud : null;
    const dist = geofencingActivo ? distancia : null;

    // Políticas de tenant: geo + Face ID + device gating.
    const cfg = await prisma.configuracionEmpresa.findUnique({
      where: { id: "singleton" },
      select: {
        geoObligatoria: true,
        faceIdObligatorio: true,
        faceIdGuardarFoto: true,
        fichajeMovilActivo: true,
        fichajeTabletActivo: true,
      },
    });

    // Si el OWNER apaga el fichaje desde móvil/tablet, rechazamos
    // requests cuyo UA encaje. Detección por UA (heurística — no
    // perfecta pero coherente con el gating cliente-side).
    const ua = request.headers.get("user-agent") || "";
    const dev = detectDeviceTypeFromUA(ua);
    if (dev === "mobile" && cfg?.fichajeMovilActivo === false) {
      return Response.json(
        { error: "El fichaje desde móvil está deshabilitado por tu empresa." },
        { status: 400 },
      );
    }
    if (dev === "tablet" && cfg?.fichajeTabletActivo === false) {
      return Response.json(
        { error: "El fichaje desde tablet está deshabilitado por tu empresa." },
        { status: 400 },
      );
    }

    if (geofencingActivo && cfg?.geoObligatoria && (lat == null || lon == null)) {
      return Response.json(
        { error: "Tu empresa requiere localización para fichar. Activa el GPS y vuelve a intentarlo." },
        { status: 400 },
      );
    }

    if (cfg?.faceIdObligatorio) {
      const tpl = await prisma.faceTemplate.findUnique({
        where: { userId: userId! },
        select: { id: true },
      });
      if (!tpl) {
        return Response.json(
          {
            error: "Tu empresa exige Face ID para fichar. Regístralo en tu perfil antes de continuar.",
            code: "face_id_required",
          },
          { status: 400 },
        );
      }
      if (faceVerified !== true) {
        return Response.json(
          {
            error: "Necesitas verificar tu rostro con Face ID antes de fichar.",
            code: "face_id_verify_required",
          },
          { status: 400 },
        );
      }
    }

    // Snapshot cifrado: solo cuando el OWNER activó faceIdGuardarFoto y
    // el fichaje viene del flujo Face ID (faceVerified=true). Aceptamos
    // hasta 200KB de data URL → ~150KB binarios tras decode.
    let fotoEnc: Uint8Array<ArrayBuffer> | null = null;
    if (cfg?.faceIdGuardarFoto && faceVerified === true && typeof fotoSnapshot === "string") {
      const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(fotoSnapshot);
      if (m && fotoSnapshot.length <= 200_000) {
        try {
          const bin = Buffer.from(m[2], "base64");
          fotoEnc = encrypt(new Uint8Array(bin));
        } catch (err) {
          console.warn("[/api/fichajes] no se pudo cifrar snapshot:", err);
        }
      }
    }

    const fichaje = await prisma.fichaje.create({
      data: {
        userId: userId!,
        tiendaId: userTiendaId,
        tipo,
        latitud: lat,
        longitud: lon,
        distancia: dist,
        metodo,
        nota,
        ip,
        ...(fotoEnc ? { fotoSnapshotEnc: fotoEnc } : {}),
      },
      include: {
        user: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        tienda: {
          select: { id: true, nombre: true },
        },
      },
    });

    return Response.json(fichaje, { status: 201 });
  } catch (error) {
    console.error("POST /api/fichajes error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

function validateTipoFichaje(
  tipo: TipoFichaje,
  ultimoTipo: TipoFichaje | null
): string | null {
  // If no previous fichaje (no active session), only ENTRADA is allowed
  if (ultimoTipo === null || ultimoTipo === TipoFichaje.SALIDA) {
    if (tipo !== TipoFichaje.ENTRADA) {
      return "Debes hacer ENTRADA antes de registrar otro fichaje";
    }
    return null;
  }

  if (ultimoTipo === TipoFichaje.ENTRADA || ultimoTipo === TipoFichaje.VUELTA_PAUSA) {
    if (tipo === TipoFichaje.ENTRADA) {
      return "Ya tienes una entrada activa. Debes hacer SALIDA primero";
    }
    if (tipo === TipoFichaje.VUELTA_PAUSA) {
      return "No estás en pausa. No puedes hacer VUELTA_PAUSA";
    }
    return null; // PAUSA or SALIDA are valid
  }

  if (ultimoTipo === TipoFichaje.PAUSA) {
    if (tipo === TipoFichaje.ENTRADA) {
      return "Ya tienes una entrada activa. Debes hacer SALIDA primero";
    }
    if (tipo === TipoFichaje.PAUSA) {
      return "Ya estás en pausa";
    }
    if (tipo === TipoFichaje.SALIDA) {
      return "Debes hacer VUELTA_PAUSA antes de SALIDA";
    }
    return null; // VUELTA_PAUSA is valid
  }

  return null;
}
