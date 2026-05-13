-- 20260513120000_user_salario_y_prenomina_enviada
--
-- 1. User.salarioBase (Decimal, nullable): salario base mensual por empleado.
--    Si NULL, el cálculo de prenómina usa ConfiguracionEmpresa.nominaSalarioBaseDefault.
-- 2. Prenomina.enviadaPorId, enviadaCanal, enviadaDestinatario: tracking del
--    envío al gestor laboral (transición CERRADA → ENVIADA).

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "salario_base" DECIMAL(10,2);

ALTER TABLE "Prenomina"
  ADD COLUMN IF NOT EXISTS "enviadaPorId"        TEXT,
  ADD COLUMN IF NOT EXISTS "enviadaCanal"        TEXT,
  ADD COLUMN IF NOT EXISTS "enviadaDestinatario" TEXT;

DO $$ BEGIN
  ALTER TABLE "Prenomina"
    ADD CONSTRAINT "Prenomina_enviadaPorId_fkey"
    FOREIGN KEY ("enviadaPorId") REFERENCES "User"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Prenomina_enviadaPorId_idx"
  ON "Prenomina"("enviadaPorId");
