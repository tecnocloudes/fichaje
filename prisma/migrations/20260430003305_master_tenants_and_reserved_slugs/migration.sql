-- CreateTable
CREATE TABLE "master"."tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "master"."TenantStatus" NOT NULL DEFAULT 'pending',
    "stripe_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."reserved_slugs" (
    "slug" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserved_slugs_pkey" PRIMARY KEY ("slug")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "master"."tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_stripe_customer_id_key" ON "master"."tenants"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "master"."tenants"("status");


-- CHECK del formato del slug (regex). ADR-001 §2.5 + ADR-002 §2.1.
ALTER TABLE "master"."tenants"
  ADD CONSTRAINT "tenants_slug_format_check"
  CHECK ("slug" ~ '^[a-z][a-z0-9_]{2,30}$');

-- CHECK de que reserved_slugs.slug viene en minúsculas.
ALTER TABLE "master"."reserved_slugs"
  ADD CONSTRAINT "reserved_slugs_lowercase_check"
  CHECK ("slug" = lower("slug"));

-- Función utilitaria: setea updated_at = now() antes del UPDATE.
-- Reutilizable por todas las tablas master con columna updated_at.
CREATE OR REPLACE FUNCTION "master"."touch_updated_at"()
RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger updated_at en master.tenants.
CREATE TRIGGER "tenants_touch_updated_at"
  BEFORE UPDATE ON "master"."tenants"
  FOR EACH ROW EXECUTE FUNCTION "master"."touch_updated_at"();

-- Función: rechaza inserts/updates de slug si está en master.reserved_slugs.
-- ADR-002 §2.1: doble validación (zod en API + trigger en BD).
CREATE OR REPLACE FUNCTION "master"."check_slug_not_reserved"()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "master"."reserved_slugs" WHERE "slug" = NEW."slug") THEN
    RAISE EXCEPTION 'Slug reservado: %', NEW."slug"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger en master.tenants.
CREATE TRIGGER "tenants_slug_not_reserved"
  BEFORE INSERT OR UPDATE OF "slug" ON "master"."tenants"
  FOR EACH ROW EXECUTE FUNCTION "master"."check_slug_not_reserved"();
