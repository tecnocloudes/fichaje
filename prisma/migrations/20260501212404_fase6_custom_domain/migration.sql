-- Fase 6 §4.1: dominio personalizado por tenant.
-- Aditiva, backward-compatible. customDomainVerified=false por
-- default garantiza que tenants existentes no afecten la resolución.

ALTER TABLE "master"."tenants"
  ADD COLUMN IF NOT EXISTS "custom_domain" TEXT;

ALTER TABLE "master"."tenants"
  ADD COLUMN IF NOT EXISTS "custom_domain_verified" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "master"."tenants"
  ADD COLUMN IF NOT EXISTS "custom_domain_token" TEXT;

-- UNIQUE constraint sobre custom_domain (NULL múltiples permitidos).
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_custom_domain_key"
  ON "master"."tenants" ("custom_domain")
  WHERE "custom_domain" IS NOT NULL;
