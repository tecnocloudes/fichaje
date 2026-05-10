import { prismaApp as prisma } from "./prisma";
import { currentTenant } from "./tenant/context";

/**
 * Adds missing columns / tables introduced since the initial schema.
 * Uses IF NOT EXISTS so it's safe to call on every app start.
 *
 * Cacheada por slug en `globalThis._migratedTenants` — la primera
 * petición de cada tenant ejecuta el SQL; las siguientes son no-op.
 * Esto permite llamarla desde cualquier handler que use columnas
 * nuevas sin penalización de rendimiento.
 */
const MIGRATED = (globalThis as { _migratedTenants?: Set<string> })._migratedTenants
  ?? ((globalThis as { _migratedTenants?: Set<string> })._migratedTenants = new Set<string>());

export async function runMigrations() {
  let slug: string | null = null;
  try {
    slug = currentTenant().slug;
  } catch {
    // Sin contexto de tenant (tests, build) → ejecuta sin cache.
  }
  if (slug && MIGRATED.has(slug)) return;

  // El SQL crudo NO usa el `schema:` configurado en PrismaPg
  // (que solo aplica al SQL generado por los modelos). Tenemos que
  // cualificar el schema explícitamente o las queries van al
  // search_path por defecto y fallan con `relation does not exist`.
  // Validamos el slug porque va a interpolarse en SQL crudo.
  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) {
    console.error(`[migrate] slug inválido para SQL: ${JSON.stringify(slug)}`);
    return;
  }
  const S = `"tenant_${slug}"`;

  try {
    // ── ConfiguracionEmpresa: notification columns ─────────────────────────
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${S}."ConfiguracionEmpresa"
        ADD COLUMN IF NOT EXISTS "notifAusencias"   BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "notifTurnos"       BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "notifTareas"       BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "notifFichajes"     BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "notifComunicados"  BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "emailActivo"       BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "emailHost"         TEXT,
        ADD COLUMN IF NOT EXISTS "emailPort"         INTEGER,
        ADD COLUMN IF NOT EXISTS "emailSecure"       BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "emailUser"         TEXT,
        ADD COLUMN IF NOT EXISTS "emailPassword"     TEXT,
        ADD COLUMN IF NOT EXISTS "emailFrom"         TEXT,
        ADD COLUMN IF NOT EXISTS "pushActivo"        BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "pushVapidPublicKey"  TEXT,
        ADD COLUMN IF NOT EXISTS "pushVapidPrivateKey" TEXT;
    `);

    // ── ConfiguracionEmpresa: branding columns ─────────────────────────────
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${S}."ConfiguracionEmpresa"
        ADD COLUMN IF NOT EXISTS "favicon"       TEXT,
        ADD COLUMN IF NOT EXISTS "colorPrimario" TEXT NOT NULL DEFAULT '#6366f1',
        ADD COLUMN IF NOT EXISTS "colorSidebar"  TEXT NOT NULL DEFAULT '#1e1b4b',
        ADD COLUMN IF NOT EXISTS "appNombre"     TEXT NOT NULL DEFAULT 'empleaIA';
    `);

    // ── ConfiguracionEmpresa: políticas de fichaje (geo + face id) ────────
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${S}."ConfiguracionEmpresa"
        ADD COLUMN IF NOT EXISTS "geo_obligatoria"       BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "face_id_obligatorio"   BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "face_id_guardar_foto"  BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "retencion_fotos_dias"  INTEGER NOT NULL DEFAULT 90;
    `);

    // ── Fichaje: snapshot facial cifrado (Bytes, opcional) ────────────────
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${S}."Fichaje"
        ADD COLUMN IF NOT EXISTS "foto_snapshot_enc" BYTEA;
    `);

    // ── PreferenciasNotificacion table ─────────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."PreferenciasNotificacion" (
        "id"               TEXT NOT NULL,
        "userId"           TEXT NOT NULL,
        "inAppAusencias"   BOOLEAN NOT NULL DEFAULT true,
        "inAppTurnos"      BOOLEAN NOT NULL DEFAULT true,
        "inAppTareas"      BOOLEAN NOT NULL DEFAULT true,
        "inAppFichajes"    BOOLEAN NOT NULL DEFAULT false,
        "inAppComunicados" BOOLEAN NOT NULL DEFAULT true,
        "emailAusencias"   BOOLEAN NOT NULL DEFAULT true,
        "emailTurnos"      BOOLEAN NOT NULL DEFAULT true,
        "emailTareas"      BOOLEAN NOT NULL DEFAULT false,
        "emailFichajes"    BOOLEAN NOT NULL DEFAULT false,
        "emailComunicados" BOOLEAN NOT NULL DEFAULT false,
        "pushAusencias"    BOOLEAN NOT NULL DEFAULT true,
        "pushTurnos"       BOOLEAN NOT NULL DEFAULT true,
        "pushTareas"       BOOLEAN NOT NULL DEFAULT true,
        "pushFichajes"     BOOLEAN NOT NULL DEFAULT false,
        "pushComunicados"  BOOLEAN NOT NULL DEFAULT false,
        "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PreferenciasNotificacion_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conname = 'PreferenciasNotificacion_userId_key'
            AND n.nspname = 'tenant_${slug}'
        ) THEN
          ALTER TABLE ${S}."PreferenciasNotificacion"
            ADD CONSTRAINT "PreferenciasNotificacion_userId_key" UNIQUE ("userId");
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conname = 'PreferenciasNotificacion_userId_fkey'
            AND n.nspname = 'tenant_${slug}'
        ) THEN
          ALTER TABLE ${S}."PreferenciasNotificacion"
            ADD CONSTRAINT "PreferenciasNotificacion_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES ${S}."User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // ── PushSubscripcion table ─────────────────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."PushSubscripcion" (
        "id"        TEXT NOT NULL,
        "userId"    TEXT NOT NULL,
        "endpoint"  TEXT NOT NULL,
        "p256dh"    TEXT NOT NULL,
        "auth"      TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PushSubscripcion_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conname = 'PushSubscripcion_endpoint_key'
            AND n.nspname = 'tenant_${slug}'
        ) THEN
          ALTER TABLE ${S}."PushSubscripcion"
            ADD CONSTRAINT "PushSubscripcion_endpoint_key" UNIQUE ("endpoint");
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conname = 'PushSubscripcion_userId_fkey'
            AND n.nspname = 'tenant_${slug}'
        ) THEN
          ALTER TABLE ${S}."PushSubscripcion"
            ADD CONSTRAINT "PushSubscripcion_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES ${S}."User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PushSubscripcion_userId_idx" ON ${S}."PushSubscripcion"("userId");
    `);

    // ── Objetivo (OKRs) table ──────────────────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."Objetivo" (
        "id"           TEXT NOT NULL,
        "titulo"       TEXT NOT NULL,
        "descripcion"  TEXT,
        "asignadoAId"  TEXT,
        "periodo"      TEXT NOT NULL,
        "estado"       TEXT NOT NULL DEFAULT 'activo',
        "progreso"     INTEGER NOT NULL DEFAULT 0,
        "creadoPorId"  TEXT NOT NULL,
        "fechaCierre"  TIMESTAMP(3),
        "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Objetivo_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Objetivo_asignadoAId_idx" ON ${S}."Objetivo"("asignadoAId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Objetivo_estado_idx" ON ${S}."Objetivo"("estado");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Objetivo_periodo_idx" ON ${S}."Objetivo"("periodo");
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conname = 'Objetivo_asignadoAId_fkey'
            AND n.nspname = 'tenant_${slug}'
        ) THEN
          ALTER TABLE ${S}."Objetivo"
            ADD CONSTRAINT "Objetivo_asignadoAId_fkey"
            FOREIGN KEY ("asignadoAId") REFERENCES ${S}."User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conname = 'Objetivo_creadoPorId_fkey'
            AND n.nspname = 'tenant_${slug}'
        ) THEN
          ALTER TABLE ${S}."Objetivo"
            ADD CONSTRAINT "Objetivo_creadoPorId_fkey"
            FOREIGN KEY ("creadoPorId") REFERENCES ${S}."User"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // ── Encuesta + RespuestaEncuesta (clima laboral) ───────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."Encuesta" (
        "id"          TEXT NOT NULL,
        "titulo"      TEXT NOT NULL,
        "descripcion" TEXT,
        "preguntas"   JSONB NOT NULL,
        "anonima"     BOOLEAN NOT NULL DEFAULT true,
        "estado"      TEXT NOT NULL DEFAULT 'abierta',
        "cierraAt"    TIMESTAMP(3),
        "creadoPorId" TEXT NOT NULL,
        "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Encuesta_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Encuesta_estado_idx" ON ${S}."Encuesta"("estado");
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conname = 'Encuesta_creadoPorId_fkey'
            AND n.nspname = 'tenant_${slug}'
        ) THEN
          ALTER TABLE ${S}."Encuesta"
            ADD CONSTRAINT "Encuesta_creadoPorId_fkey"
            FOREIGN KEY ("creadoPorId") REFERENCES ${S}."User"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."RespuestaEncuesta" (
        "id"         TEXT NOT NULL,
        "encuestaId" TEXT NOT NULL,
        "userId"     TEXT,
        "respuestas" JSONB NOT NULL,
        "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "RespuestaEncuesta_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "RespuestaEncuesta_encuestaId_idx" ON ${S}."RespuestaEncuesta"("encuestaId");
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conname = 'RespuestaEncuesta_encuestaId_fkey'
            AND n.nspname = 'tenant_${slug}'
        ) THEN
          ALTER TABLE ${S}."RespuestaEncuesta"
            ADD CONSTRAINT "RespuestaEncuesta_encuestaId_fkey"
            FOREIGN KEY ("encuestaId") REFERENCES ${S}."Encuesta"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conname = 'RespuestaEncuesta_userId_fkey'
            AND n.nspname = 'tenant_${slug}'
        ) THEN
          ALTER TABLE ${S}."RespuestaEncuesta"
            ADD CONSTRAINT "RespuestaEncuesta_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES ${S}."User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conname = 'RespuestaEncuesta_encuestaId_userId_key'
            AND n.nspname = 'tenant_${slug}'
        ) THEN
          ALTER TABLE ${S}."RespuestaEncuesta"
            ADD CONSTRAINT "RespuestaEncuesta_encuestaId_userId_key"
            UNIQUE ("encuestaId", "userId");
        END IF;
      END $$;
    `);

    // ── Evaluacion ────────────────────────────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."Evaluacion" (
        "id"           TEXT NOT NULL,
        "ciclo"        TEXT NOT NULL,
        "evaluadoAId"  TEXT NOT NULL,
        "evaluadorId"  TEXT NOT NULL,
        "preguntas"    JSONB NOT NULL,
        "respuestas"   JSONB,
        "comentarios"  TEXT,
        "estado"       TEXT NOT NULL DEFAULT 'pendiente',
        "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "completadaAt" TIMESTAMP(3),
        CONSTRAINT "Evaluacion_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Evaluacion_evaluadoAId_idx" ON ${S}."Evaluacion"("evaluadoAId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Evaluacion_evaluadorId_idx" ON ${S}."Evaluacion"("evaluadorId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Evaluacion_ciclo_idx" ON ${S}."Evaluacion"("ciclo");`);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='Evaluacion_evaluadoAId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."Evaluacion" ADD CONSTRAINT "Evaluacion_evaluadoAId_fkey" FOREIGN KEY ("evaluadoAId") REFERENCES ${S}."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='Evaluacion_evaluadorId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."Evaluacion" ADD CONSTRAINT "Evaluacion_evaluadorId_fkey" FOREIGN KEY ("evaluadorId") REFERENCES ${S}."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // ── Gasto ─────────────────────────────────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."Gasto" (
        "id"          TEXT NOT NULL,
        "userId"      TEXT NOT NULL,
        "concepto"    TEXT NOT NULL,
        "importe"     DECIMAL(10,2) NOT NULL,
        "moneda"      TEXT NOT NULL DEFAULT 'EUR',
        "categoria"   TEXT NOT NULL DEFAULT 'varios',
        "fecha"       TIMESTAMP(3) NOT NULL,
        "ticketUrl"   TEXT,
        "notas"       TEXT,
        "estado"      TEXT NOT NULL DEFAULT 'pendiente',
        "revisorId"   TEXT,
        "revisadoAt"  TIMESTAMP(3),
        "comentarioRevision" TEXT,
        "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Gasto_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Gasto_userId_idx" ON ${S}."Gasto"("userId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Gasto_estado_idx" ON ${S}."Gasto"("estado");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Gasto_fecha_idx" ON ${S}."Gasto"("fecha");`);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='Gasto_userId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."Gasto" ADD CONSTRAINT "Gasto_userId_fkey" FOREIGN KEY ("userId") REFERENCES ${S}."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='Gasto_revisorId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."Gasto" ADD CONSTRAINT "Gasto_revisorId_fkey" FOREIGN KEY ("revisorId") REFERENCES ${S}."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // ── EspacioReservable + ReservaEspacio ────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."EspacioReservable" (
        "id"          TEXT NOT NULL,
        "nombre"      TEXT NOT NULL,
        "descripcion" TEXT,
        "capacidad"   INTEGER NOT NULL DEFAULT 1,
        "ubicacion"   TEXT,
        "activo"      BOOLEAN NOT NULL DEFAULT true,
        "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "EspacioReservable_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."ReservaEspacio" (
        "id"        TEXT NOT NULL,
        "espacioId" TEXT NOT NULL,
        "userId"    TEXT NOT NULL,
        "inicio"    TIMESTAMP(3) NOT NULL,
        "fin"       TIMESTAMP(3) NOT NULL,
        "motivo"    TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ReservaEspacio_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReservaEspacio_espacioId_inicio_idx" ON ${S}."ReservaEspacio"("espacioId","inicio");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReservaEspacio_userId_idx" ON ${S}."ReservaEspacio"("userId");`);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='ReservaEspacio_espacioId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."ReservaEspacio" ADD CONSTRAINT "ReservaEspacio_espacioId_fkey" FOREIGN KEY ("espacioId") REFERENCES ${S}."EspacioReservable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='ReservaEspacio_userId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."ReservaEspacio" ADD CONSTRAINT "ReservaEspacio_userId_fkey" FOREIGN KEY ("userId") REFERENCES ${S}."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // ── NominaArchivo ─────────────────────────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."NominaArchivo" (
        "id"            TEXT NOT NULL,
        "empleadoId"    TEXT NOT NULL,
        "periodo"       TEXT NOT NULL,
        "pdfUrl"        TEXT NOT NULL,
        "nombreArchivo" TEXT NOT NULL,
        "tamañoBytes"   INTEGER NOT NULL DEFAULT 0,
        "subidoPorId"   TEXT NOT NULL,
        "vistoAt"       TIMESTAMP(3),
        "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "NominaArchivo_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "NominaArchivo_empleadoId_idx" ON ${S}."NominaArchivo"("empleadoId");`);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='NominaArchivo_empleadoId_periodo_key' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."NominaArchivo" ADD CONSTRAINT "NominaArchivo_empleadoId_periodo_key" UNIQUE ("empleadoId","periodo");
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='NominaArchivo_empleadoId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."NominaArchivo" ADD CONSTRAINT "NominaArchivo_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES ${S}."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='NominaArchivo_subidoPorId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."NominaArchivo" ADD CONSTRAINT "NominaArchivo_subidoPorId_fkey" FOREIGN KEY ("subidoPorId") REFERENCES ${S}."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // ── Curso + AsignacionCurso ───────────────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."Curso" (
        "id"           TEXT NOT NULL,
        "titulo"       TEXT NOT NULL,
        "descripcion"  TEXT,
        "contenidoUrl" TEXT,
        "duracionMin"  INTEGER NOT NULL DEFAULT 60,
        "creadoPorId"  TEXT NOT NULL,
        "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Curso_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."AsignacionCurso" (
        "id"           TEXT NOT NULL,
        "cursoId"      TEXT NOT NULL,
        "empleadoId"   TEXT NOT NULL,
        "fechaLimite"  TIMESTAMP(3),
        "completado"   BOOLEAN NOT NULL DEFAULT false,
        "completadoAt" TIMESTAMP(3),
        "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AsignacionCurso_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AsignacionCurso_empleadoId_idx" ON ${S}."AsignacionCurso"("empleadoId");`);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='AsignacionCurso_cursoId_empleadoId_key' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."AsignacionCurso" ADD CONSTRAINT "AsignacionCurso_cursoId_empleadoId_key" UNIQUE ("cursoId","empleadoId");
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='Curso_creadoPorId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."Curso" ADD CONSTRAINT "Curso_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES ${S}."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='AsignacionCurso_cursoId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."AsignacionCurso" ADD CONSTRAINT "AsignacionCurso_cursoId_fkey" FOREIGN KEY ("cursoId") REFERENCES ${S}."Curso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='AsignacionCurso_empleadoId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."AsignacionCurso" ADD CONSTRAINT "AsignacionCurso_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES ${S}."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // ── Peticion ──────────────────────────────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ${S}."Peticion" (
        "id"            TEXT NOT NULL,
        "solicitanteId" TEXT NOT NULL,
        "tipo"          TEXT NOT NULL,
        "titulo"        TEXT NOT NULL,
        "descripcion"   TEXT NOT NULL,
        "estado"        TEXT NOT NULL DEFAULT 'pendiente',
        "respuesta"     TEXT,
        "gestorId"      TEXT,
        "resueltaAt"    TIMESTAMP(3),
        "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Peticion_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Peticion_solicitanteId_idx" ON ${S}."Peticion"("solicitanteId");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Peticion_estado_idx" ON ${S}."Peticion"("estado");`);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='Peticion_solicitanteId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."Peticion" ADD CONSTRAINT "Peticion_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES ${S}."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='Peticion_gestorId_fkey' AND n.nspname='tenant_${slug}') THEN
          ALTER TABLE ${S}."Peticion" ADD CONSTRAINT "Peticion_gestorId_fkey" FOREIGN KEY ("gestorId") REFERENCES ${S}."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    MIGRATED.add(slug);
  } catch (err) {
    // Log but don't crash — if DB isn't ready yet it'll retry on next request
    console.error("[migrate] Error running lazy migrations:", err);
  }
}
