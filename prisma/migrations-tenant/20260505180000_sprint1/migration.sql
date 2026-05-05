-- Sprint 1: organigrama + firma extendida + reclutamiento.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ORGANIGRAMA: managerId self-reference en User
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "User" ADD COLUMN "managerId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_managerId_idx" ON "User"("managerId");

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. FIRMA ELECTRÓNICA: SolicitudFirma + extensión de Firma
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE "EstadoSolicitudFirma" AS ENUM (
  'pendiente',
  'firmada',
  'rechazada',
  'expirada'
);

CREATE TABLE "SolicitudFirma" (
  "id" TEXT NOT NULL,
  "documentoId" TEXT NOT NULL,
  "destinatarioId" TEXT NOT NULL,
  "solicitadaPorId" TEXT NOT NULL,
  "mensaje" TEXT,
  "estado" "EstadoSolicitudFirma" NOT NULL DEFAULT 'pendiente',
  "expira_en" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SolicitudFirma_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SolicitudFirma_destinatarioId_idx" ON "SolicitudFirma"("destinatarioId");
CREATE INDEX "SolicitudFirma_documentoId_idx" ON "SolicitudFirma"("documentoId");
CREATE INDEX "SolicitudFirma_estado_idx" ON "SolicitudFirma"("estado");

ALTER TABLE "SolicitudFirma"
  ADD CONSTRAINT "SolicitudFirma_documentoId_fkey"
  FOREIGN KEY ("documentoId") REFERENCES "Documento"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SolicitudFirma"
  ADD CONSTRAINT "SolicitudFirma_destinatarioId_fkey"
  FOREIGN KEY ("destinatarioId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SolicitudFirma"
  ADD CONSTRAINT "SolicitudFirma_solicitadaPorId_fkey"
  FOREIGN KEY ("solicitadaPorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Vínculo opcional Firma → SolicitudFirma (1:1).
ALTER TABLE "Firma" ADD COLUMN "solicitudId" TEXT;
CREATE UNIQUE INDEX "Firma_solicitudId_key" ON "Firma"("solicitudId");
ALTER TABLE "Firma"
  ADD CONSTRAINT "Firma_solicitudId_fkey"
  FOREIGN KEY ("solicitudId") REFERENCES "SolicitudFirma"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RECLUTAMIENTO: OfertaTrabajo + Candidato
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE "EstadoOferta" AS ENUM (
  'borrador',
  'abierta',
  'pausada',
  'cerrada'
);

CREATE TYPE "EstadoCandidato" AS ENUM (
  'recibido',
  'preseleccionado',
  'entrevista',
  'oferta_enviada',
  'contratado',
  'rechazado'
);

CREATE TABLE "OfertaTrabajo" (
  "id" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "descripcion" TEXT NOT NULL,
  "departamento" TEXT,
  "ubicacion" TEXT,
  "modalidad" TEXT,
  "salario_min_cents" INTEGER,
  "salario_max_cents" INTEGER,
  "estado" "EstadoOferta" NOT NULL DEFAULT 'borrador',
  "fecha_cierre" TIMESTAMP(3),
  "creadorId" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfertaTrabajo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfertaTrabajo_estado_idx" ON "OfertaTrabajo"("estado");
CREATE INDEX "OfertaTrabajo_creadorId_idx" ON "OfertaTrabajo"("creadorId");

ALTER TABLE "OfertaTrabajo"
  ADD CONSTRAINT "OfertaTrabajo_creadorId_fkey"
  FOREIGN KEY ("creadorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Candidato" (
  "id" TEXT NOT NULL,
  "ofertaId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "apellidos" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "telefono" TEXT,
  "cv_url" TEXT,
  "linkedin_url" TEXT,
  "notas" TEXT,
  "estado" "EstadoCandidato" NOT NULL DEFAULT 'recibido',
  "creadorId" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Candidato_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Candidato_ofertaId_idx" ON "Candidato"("ofertaId");
CREATE INDEX "Candidato_estado_idx" ON "Candidato"("estado");
CREATE INDEX "Candidato_email_idx" ON "Candidato"("email");

ALTER TABLE "Candidato"
  ADD CONSTRAINT "Candidato_ofertaId_fkey"
  FOREIGN KEY ("ofertaId") REFERENCES "OfertaTrabajo"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Candidato"
  ADD CONSTRAINT "Candidato_creadorId_fkey"
  FOREIGN KEY ("creadorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
