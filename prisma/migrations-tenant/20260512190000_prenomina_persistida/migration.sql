-- Prenómina persistida (Enterprise-ready).
-- Convierte el agregado on-the-fly en snapshot mes/empleado con:
--   - Estados (BORRADOR/CERRADA/ENVIADA) y workflow de cierre
--   - Conceptos manuales (dietas, kilometraje, comisiones, plus, otros)
--   - Reglas de cálculo configurables por tenant
-- Idempotente con IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Enums
-- ═══════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE "EstadoPrenomina" AS ENUM ('BORRADOR', 'CERRADA', 'ENVIADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TipoConceptoPrenomina" AS ENUM ('DIETA', 'KILOMETRAJE', 'COMISION', 'PLUS', 'BONUS', 'DEDUCCION', 'OTRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. ConfiguracionEmpresa — reglas de cálculo
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "nominaJornadaSemanal"       DECIMAL(5,2) NOT NULL DEFAULT 40.00,
  ADD COLUMN IF NOT EXISTS "nominaHoraExtraFactor"      DECIMAL(4,2) NOT NULL DEFAULT 1.75,
  ADD COLUMN IF NOT EXISTS "nominaPlusNocturnidadActivo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nominaNocturnidadDesde"     TEXT NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS "nominaNocturnidadHasta"     TEXT NOT NULL DEFAULT '06:00',
  ADD COLUMN IF NOT EXISTS "nominaPlusNocturnidadFactor" DECIMAL(4,2) NOT NULL DEFAULT 1.25,
  ADD COLUMN IF NOT EXISTS "nominaPlusFestivoActivo"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nominaPlusFestivoFactor"    DECIMAL(4,2) NOT NULL DEFAULT 1.75,
  ADD COLUMN IF NOT EXISTS "nominaSalarioBaseDefault"   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "nominaMoneda"               TEXT NOT NULL DEFAULT 'EUR';

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Prenomina — snapshot por periodo y empleado
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Prenomina" (
  "id"                  TEXT NOT NULL,
  "periodo"             TEXT NOT NULL,
  "empleadoId"          TEXT NOT NULL,
  "estado"              "EstadoPrenomina" NOT NULL DEFAULT 'BORRADOR',
  "horasTrabajadas"     DECIMAL(7,2) NOT NULL DEFAULT 0,
  "horasOrdinarias"     DECIMAL(7,2) NOT NULL DEFAULT 0,
  "horasExtras"         DECIMAL(7,2) NOT NULL DEFAULT 0,
  "horasNocturnas"      DECIMAL(7,2) NOT NULL DEFAULT 0,
  "horasFestivas"       DECIMAL(7,2) NOT NULL DEFAULT 0,
  "diasTrabajados"      INTEGER NOT NULL DEFAULT 0,
  "diasAusenciaPagada"  INTEGER NOT NULL DEFAULT 0,
  "diasAusenciaNoPagada" INTEGER NOT NULL DEFAULT 0,
  "salarioBase"         DECIMAL(10,2) NOT NULL DEFAULT 0,
  "importeHorasExtras"  DECIMAL(10,2) NOT NULL DEFAULT 0,
  "importeNocturnidad"  DECIMAL(10,2) NOT NULL DEFAULT 0,
  "importeFestivos"     DECIMAL(10,2) NOT NULL DEFAULT 0,
  "importeConceptos"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "totalBruto"          DECIMAL(10,2) NOT NULL DEFAULT 0,
  "moneda"              TEXT NOT NULL DEFAULT 'EUR',
  "comentario"          TEXT,
  "calculadaAt"         TIMESTAMP(3),
  "cerradaAt"           TIMESTAMP(3),
  "cerradaPorId"        TEXT,
  "enviadaAt"           TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Prenomina_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Prenomina_periodo_idx"    ON "Prenomina"("periodo");
CREATE INDEX IF NOT EXISTS "Prenomina_empleadoId_idx" ON "Prenomina"("empleadoId");
CREATE INDEX IF NOT EXISTS "Prenomina_estado_idx"     ON "Prenomina"("estado");

DO $$ BEGIN
  ALTER TABLE "Prenomina" ADD CONSTRAINT "Prenomina_periodo_empleadoId_key" UNIQUE ("periodo","empleadoId");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Prenomina" ADD CONSTRAINT "Prenomina_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Prenomina" ADD CONSTRAINT "Prenomina_cerradaPorId_fkey" FOREIGN KEY ("cerradaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. PrenominaConcepto — conceptos manuales por prenómina
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "PrenominaConcepto" (
  "id"           TEXT NOT NULL,
  "prenominaId"  TEXT NOT NULL,
  "tipo"         "TipoConceptoPrenomina" NOT NULL,
  "descripcion"  TEXT NOT NULL,
  "cantidad"     DECIMAL(8,2),
  "importe"      DECIMAL(10,2) NOT NULL,
  "notas"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrenominaConcepto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PrenominaConcepto_prenominaId_idx" ON "PrenominaConcepto"("prenominaId");

DO $$ BEGIN
  ALTER TABLE "PrenominaConcepto" ADD CONSTRAINT "PrenominaConcepto_prenominaId_fkey" FOREIGN KEY ("prenominaId") REFERENCES "Prenomina"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;
