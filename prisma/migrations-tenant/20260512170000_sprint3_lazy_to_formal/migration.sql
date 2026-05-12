-- Sprint 3 consolidation: convierte las "lazy migrations" de
-- src/lib/migrate.ts en una migración formal. Idempotente (todo
-- usa IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object) para
-- que sea segura tanto en tenants nuevos como en cualquier tenant
-- que ya tuviese partes aplicadas vía la lazy migration anterior.
--
-- El motor de migrations-tenant aplica SET search_path al schema
-- del tenant antes de ejecutar este archivo, por eso no se
-- cualifica el schema en las sentencias.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. ConfiguracionEmpresa — notification + branding + políticas fichaje
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "notifAusencias"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notifTurnos"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notifTareas"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notifFichajes"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "notifComunicados" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailActivo"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "emailHost"        TEXT,
  ADD COLUMN IF NOT EXISTS "emailPort"        INTEGER,
  ADD COLUMN IF NOT EXISTS "emailSecure"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emailUser"        TEXT,
  ADD COLUMN IF NOT EXISTS "emailPassword"    TEXT,
  ADD COLUMN IF NOT EXISTS "emailFrom"        TEXT,
  ADD COLUMN IF NOT EXISTS "pushActivo"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pushVapidPublicKey"  TEXT,
  ADD COLUMN IF NOT EXISTS "pushVapidPrivateKey" TEXT,
  ADD COLUMN IF NOT EXISTS "favicon"        TEXT,
  ADD COLUMN IF NOT EXISTS "colorPrimario"  TEXT NOT NULL DEFAULT '#6366f1',
  ADD COLUMN IF NOT EXISTS "colorSidebar"   TEXT NOT NULL DEFAULT '#1e1b4b',
  ADD COLUMN IF NOT EXISTS "appNombre"      TEXT NOT NULL DEFAULT 'empleaIA',
  ADD COLUMN IF NOT EXISTS "geo_obligatoria"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "face_id_obligatorio"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "face_id_guardar_foto"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "retencion_fotos_dias"  INTEGER NOT NULL DEFAULT 90;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Fichaje — snapshot Face ID cifrado
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "Fichaje"
  ADD COLUMN IF NOT EXISTS "foto_snapshot_enc" BYTEA;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. PreferenciasNotificacion
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "PreferenciasNotificacion" (
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

DO $$ BEGIN
  ALTER TABLE "PreferenciasNotificacion" ADD CONSTRAINT "PreferenciasNotificacion_userId_key" UNIQUE ("userId");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PreferenciasNotificacion" ADD CONSTRAINT "PreferenciasNotificacion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. PushSubscripcion
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "PushSubscripcion" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "endpoint"  TEXT NOT NULL,
  "p256dh"    TEXT NOT NULL,
  "auth"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscripcion_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "PushSubscripcion" ADD CONSTRAINT "PushSubscripcion_endpoint_key" UNIQUE ("endpoint");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PushSubscripcion" ADD CONSTRAINT "PushSubscripcion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "PushSubscripcion_userId_idx" ON "PushSubscripcion"("userId");

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Objetivo (OKRs)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Objetivo" (
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

CREATE INDEX IF NOT EXISTS "Objetivo_asignadoAId_idx" ON "Objetivo"("asignadoAId");
CREATE INDEX IF NOT EXISTS "Objetivo_estado_idx"      ON "Objetivo"("estado");
CREATE INDEX IF NOT EXISTS "Objetivo_periodo_idx"     ON "Objetivo"("periodo");

DO $$ BEGIN
  ALTER TABLE "Objetivo" ADD CONSTRAINT "Objetivo_asignadoAId_fkey" FOREIGN KEY ("asignadoAId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Objetivo" ADD CONSTRAINT "Objetivo_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Encuesta + RespuestaEncuesta
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Encuesta" (
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

CREATE INDEX IF NOT EXISTS "Encuesta_estado_idx" ON "Encuesta"("estado");

DO $$ BEGIN
  ALTER TABLE "Encuesta" ADD CONSTRAINT "Encuesta_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RespuestaEncuesta" (
  "id"         TEXT NOT NULL,
  "encuestaId" TEXT NOT NULL,
  "userId"     TEXT,
  "respuestas" JSONB NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RespuestaEncuesta_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RespuestaEncuesta_encuestaId_idx" ON "RespuestaEncuesta"("encuestaId");

DO $$ BEGIN
  ALTER TABLE "RespuestaEncuesta" ADD CONSTRAINT "RespuestaEncuesta_encuestaId_fkey" FOREIGN KEY ("encuestaId") REFERENCES "Encuesta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RespuestaEncuesta" ADD CONSTRAINT "RespuestaEncuesta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RespuestaEncuesta" ADD CONSTRAINT "RespuestaEncuesta_encuestaId_userId_key" UNIQUE ("encuestaId","userId");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Evaluacion
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Evaluacion" (
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

CREATE INDEX IF NOT EXISTS "Evaluacion_evaluadoAId_idx" ON "Evaluacion"("evaluadoAId");
CREATE INDEX IF NOT EXISTS "Evaluacion_evaluadorId_idx" ON "Evaluacion"("evaluadorId");
CREATE INDEX IF NOT EXISTS "Evaluacion_ciclo_idx"       ON "Evaluacion"("ciclo");

DO $$ BEGIN
  ALTER TABLE "Evaluacion" ADD CONSTRAINT "Evaluacion_evaluadoAId_fkey" FOREIGN KEY ("evaluadoAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Evaluacion" ADD CONSTRAINT "Evaluacion_evaluadorId_fkey" FOREIGN KEY ("evaluadorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. Gasto
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Gasto" (
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

CREATE INDEX IF NOT EXISTS "Gasto_userId_idx" ON "Gasto"("userId");
CREATE INDEX IF NOT EXISTS "Gasto_estado_idx" ON "Gasto"("estado");
CREATE INDEX IF NOT EXISTS "Gasto_fecha_idx"  ON "Gasto"("fecha");

DO $$ BEGIN
  ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_revisorId_fkey" FOREIGN KEY ("revisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. EspacioReservable + ReservaEspacio
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "EspacioReservable" (
  "id"          TEXT NOT NULL,
  "nombre"      TEXT NOT NULL,
  "descripcion" TEXT,
  "capacidad"   INTEGER NOT NULL DEFAULT 1,
  "ubicacion"   TEXT,
  "activo"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EspacioReservable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ReservaEspacio" (
  "id"        TEXT NOT NULL,
  "espacioId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "inicio"    TIMESTAMP(3) NOT NULL,
  "fin"       TIMESTAMP(3) NOT NULL,
  "motivo"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReservaEspacio_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReservaEspacio_espacioId_inicio_idx" ON "ReservaEspacio"("espacioId","inicio");
CREATE INDEX IF NOT EXISTS "ReservaEspacio_userId_idx"           ON "ReservaEspacio"("userId");

DO $$ BEGIN
  ALTER TABLE "ReservaEspacio" ADD CONSTRAINT "ReservaEspacio_espacioId_fkey" FOREIGN KEY ("espacioId") REFERENCES "EspacioReservable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ReservaEspacio" ADD CONSTRAINT "ReservaEspacio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. NominaArchivo
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "NominaArchivo" (
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

CREATE INDEX IF NOT EXISTS "NominaArchivo_empleadoId_idx" ON "NominaArchivo"("empleadoId");

DO $$ BEGIN
  ALTER TABLE "NominaArchivo" ADD CONSTRAINT "NominaArchivo_empleadoId_periodo_key" UNIQUE ("empleadoId","periodo");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NominaArchivo" ADD CONSTRAINT "NominaArchivo_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NominaArchivo" ADD CONSTRAINT "NominaArchivo_subidoPorId_fkey" FOREIGN KEY ("subidoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 11. Curso + AsignacionCurso
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Curso" (
  "id"           TEXT NOT NULL,
  "titulo"       TEXT NOT NULL,
  "descripcion"  TEXT,
  "contenidoUrl" TEXT,
  "duracionMin"  INTEGER NOT NULL DEFAULT 60,
  "creadoPorId"  TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Curso_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AsignacionCurso" (
  "id"           TEXT NOT NULL,
  "cursoId"      TEXT NOT NULL,
  "empleadoId"   TEXT NOT NULL,
  "fechaLimite"  TIMESTAMP(3),
  "completado"   BOOLEAN NOT NULL DEFAULT false,
  "completadoAt" TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AsignacionCurso_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AsignacionCurso_empleadoId_idx" ON "AsignacionCurso"("empleadoId");

DO $$ BEGIN
  ALTER TABLE "AsignacionCurso" ADD CONSTRAINT "AsignacionCurso_cursoId_empleadoId_key" UNIQUE ("cursoId","empleadoId");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Curso" ADD CONSTRAINT "Curso_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AsignacionCurso" ADD CONSTRAINT "AsignacionCurso_cursoId_fkey" FOREIGN KEY ("cursoId") REFERENCES "Curso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AsignacionCurso" ADD CONSTRAINT "AsignacionCurso_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 12. Peticion (custom_requests)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Peticion" (
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

CREATE INDEX IF NOT EXISTS "Peticion_solicitanteId_idx" ON "Peticion"("solicitanteId");
CREATE INDEX IF NOT EXISTS "Peticion_estado_idx"        ON "Peticion"("estado");

DO $$ BEGIN
  ALTER TABLE "Peticion" ADD CONSTRAINT "Peticion_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Peticion" ADD CONSTRAINT "Peticion_gestorId_fkey" FOREIGN KEY ("gestorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 13. Empresa (multi_empresa) + User.empresaId
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Empresa" (
  "id"           TEXT NOT NULL,
  "nombre"       TEXT NOT NULL,
  "cif"          TEXT NOT NULL,
  "direccion"    TEXT,
  "codigoPostal" TEXT,
  "ciudad"       TEXT,
  "pais"         TEXT DEFAULT 'España',
  "telefono"     TEXT,
  "email"        TEXT,
  "activa"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_cif_key" UNIQUE ("cif");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "empresaId" TEXT;

DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 14. Chat: Conversacion + ParticipanteConversacion + Mensaje
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Conversacion" (
  "id"          TEXT NOT NULL,
  "nombre"      TEXT,
  "tipo"        TEXT NOT NULL DEFAULT 'directo',
  "creadoPorId" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Conversacion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ParticipanteConversacion" (
  "id"             TEXT NOT NULL,
  "conversacionId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "ultimoLeidoAt"  TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParticipanteConversacion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ParticipanteConversacion_userId_idx" ON "ParticipanteConversacion"("userId");

DO $$ BEGIN
  ALTER TABLE "ParticipanteConversacion" ADD CONSTRAINT "ParticipanteConversacion_conversacionId_userId_key" UNIQUE ("conversacionId","userId");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ParticipanteConversacion" ADD CONSTRAINT "ParticipanteConversacion_conversacionId_fkey" FOREIGN KEY ("conversacionId") REFERENCES "Conversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ParticipanteConversacion" ADD CONSTRAINT "ParticipanteConversacion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Mensaje" (
  "id"             TEXT NOT NULL,
  "conversacionId" TEXT NOT NULL,
  "autorId"        TEXT NOT NULL,
  "texto"          TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Mensaje_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Mensaje_conversacionId_createdAt_idx" ON "Mensaje"("conversacionId","createdAt");

DO $$ BEGIN
  ALTER TABLE "Mensaje" ADD CONSTRAINT "Mensaje_conversacionId_fkey" FOREIGN KEY ("conversacionId") REFERENCES "Conversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Mensaje" ADD CONSTRAINT "Mensaje_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 15. WhatsappConfig + MensajeWhatsapp
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "WhatsappConfig" (
  "id"            TEXT NOT NULL DEFAULT 'singleton',
  "phoneNumberId" TEXT,
  "tokenEnc"      BYTEA,
  "numeroEmpresa" TEXT,
  "activo"        BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsappConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MensajeWhatsapp" (
  "id"                   TEXT NOT NULL,
  "destinatarioTelefono" TEXT NOT NULL,
  "texto"                TEXT NOT NULL,
  "estado"               TEXT NOT NULL DEFAULT 'pendiente',
  "motivoError"          TEXT,
  "enviadoAt"            TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MensajeWhatsapp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MensajeWhatsapp_estado_idx"    ON "MensajeWhatsapp"("estado");
CREATE INDEX IF NOT EXISTS "MensajeWhatsapp_createdAt_idx" ON "MensajeWhatsapp"("createdAt");

-- ═══════════════════════════════════════════════════════════════════════
-- 16. Integracion + IntegracionInstalada (marketplace) + seed
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Integracion" (
  "id"           TEXT NOT NULL,
  "slug"         TEXT NOT NULL,
  "nombre"       TEXT NOT NULL,
  "descripcion"  TEXT NOT NULL,
  "categoria"    TEXT NOT NULL,
  "logoUrl"      TEXT,
  "esquemaConfig" JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Integracion_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Integracion" ADD CONSTRAINT "Integracion_slug_key" UNIQUE ("slug");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "IntegracionInstalada" (
  "id"            TEXT NOT NULL,
  "integracionId" TEXT NOT NULL,
  "configuracion" JSONB NOT NULL,
  "activa"        BOOLEAN NOT NULL DEFAULT true,
  "activadaPorId" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegracionInstalada_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "IntegracionInstalada" ADD CONSTRAINT "IntegracionInstalada_integracionId_key" UNIQUE ("integracionId");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "IntegracionInstalada" ADD CONSTRAINT "IntegracionInstalada_integracionId_fkey" FOREIGN KEY ("integracionId") REFERENCES "Integracion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- Seed del catálogo de integraciones (idempotente por slug).
INSERT INTO "Integracion" ("id","slug","nombre","descripcion","categoria","logoUrl")
VALUES
  ('intg_slack','slack','Slack','Notifica eventos a tus canales de Slack.','comunicacion',NULL),
  ('intg_gworkspace','google-workspace','Google Workspace','Sincroniza usuarios y calendarios.','calendario',NULL),
  ('intg_microsoft','microsoft-365','Microsoft 365','Sincroniza con Outlook y Teams.','calendario',NULL),
  ('intg_sage','sage-nominas','Sage Nóminas','Exporta horas trabajadas a Sage.','nominas',NULL),
  ('intg_a3','a3-nom','A3 Nóminas','Exporta horas trabajadas a A3.','nominas',NULL),
  ('intg_zoom','zoom','Zoom','Crea reuniones desde turnos.','comunicacion',NULL),
  ('intg_factorial','factorial','Factorial','Importa datos de empleados.','rrhh',NULL),
  ('intg_holded','holded','Holded','Sincroniza facturas y gastos.','contabilidad',NULL)
ON CONFLICT ("slug") DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 17. DeclaracionFlex (retribucion_flex)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "DeclaracionFlex" (
  "id"         TEXT NOT NULL,
  "empleadoId" TEXT NOT NULL,
  "periodo"    TEXT NOT NULL,
  "concepto"   TEXT NOT NULL,
  "importe"    DECIMAL(10,2) NOT NULL,
  "notas"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeclaracionFlex_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeclaracionFlex_empleadoId_periodo_idx" ON "DeclaracionFlex"("empleadoId","periodo");

DO $$ BEGIN
  ALTER TABLE "DeclaracionFlex" ADD CONSTRAINT "DeclaracionFlex_empleadoId_periodo_concepto_key" UNIQUE ("empleadoId","periodo","concepto");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DeclaracionFlex" ADD CONSTRAINT "DeclaracionFlex_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;
