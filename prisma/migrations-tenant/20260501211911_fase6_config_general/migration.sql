-- Fase 6 §3.1: configuración general por tenant.
-- Aditiva, backward-compatible. Defaults garantizan que filas existentes
-- queden en estado coherente sin necesidad de UPDATE post-migración.

ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "zonaHoraria" TEXT NOT NULL DEFAULT 'Europe/Madrid';

ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "diasLaborables" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5];

ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "ausenciasDefaults" JSONB;
