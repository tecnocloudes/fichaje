-- Sprint 2: Asistente IA (BYOK) + Face ID.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ASISTENTE IA — multi-proveedor BYOK con cifrado AES-256-GCM
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE "ProveedorIA" AS ENUM ('anthropic', 'openai', 'google');

CREATE TABLE "IAConfiguracion" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "provider" "ProveedorIA" NOT NULL,
  "api_key_enc" BYTEA NOT NULL,
  "modelo" TEXT NOT NULL,
  "endpoint_url" TEXT,
  "system_prompt" TEXT,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "ultima_prueba_at" TIMESTAMP(3),
  "ultima_prueba_ok" BOOLEAN,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IAConfiguracion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversacionIA" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversacionIA_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversacionIA_userId_idx" ON "ConversacionIA"("userId");
CREATE INDEX "ConversacionIA_updated_at_idx" ON "ConversacionIA"("updated_at");

ALTER TABLE "ConversacionIA"
  ADD CONSTRAINT "ConversacionIA_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MensajeIA" (
  "id" TEXT NOT NULL,
  "conversacionId" TEXT NOT NULL,
  "rol" TEXT NOT NULL,
  "contenido" TEXT NOT NULL,
  "tokens_input" INTEGER,
  "tokens_output" INTEGER,
  "modelo" TEXT,
  "error_msg" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MensajeIA_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MensajeIA_conversacionId_idx" ON "MensajeIA"("conversacionId");

ALTER TABLE "MensajeIA"
  ADD CONSTRAINT "MensajeIA_conversacionId_fkey"
  FOREIGN KEY ("conversacionId") REFERENCES "ConversacionIA"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. FACE ID — biometría con cifrado AES-256-GCM
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "FaceTemplate" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "embedding_enc" BYTEA NOT NULL,
  "algoritmo" TEXT NOT NULL DEFAULT 'face-api.js@0.22',
  "consentimiento_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consentimiento_ip" TEXT,
  "consentimiento_ua" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FaceTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FaceTemplate_userId_key" ON "FaceTemplate"("userId");

ALTER TABLE "FaceTemplate"
  ADD CONSTRAINT "FaceTemplate_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FaceVerificacion" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "resultado" TEXT NOT NULL,
  "ip" TEXT,
  "user_agent" TEXT,
  "fichaje_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FaceVerificacion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FaceVerificacion_templateId_idx" ON "FaceVerificacion"("templateId");
CREATE INDEX "FaceVerificacion_created_at_idx" ON "FaceVerificacion"("created_at");

ALTER TABLE "FaceVerificacion"
  ADD CONSTRAINT "FaceVerificacion_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "FaceTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
