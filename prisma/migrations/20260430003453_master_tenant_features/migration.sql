-- CreateTable
CREATE TABLE "master"."tenant_features" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" "master"."FeatureSource" NOT NULL,
    "expires_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_features_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_features_tenant_id_feature_key_idx" ON "master"."tenant_features"("tenant_id", "feature_key");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_features_tenant_id_feature_key_source_key" ON "master"."tenant_features"("tenant_id", "feature_key", "source");

-- AddForeignKey
ALTER TABLE "master"."tenant_features" ADD CONSTRAINT "tenant_features_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "master"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CHECK: source='manual_override' exige reason no nulo y >= 10 chars.
-- ADR-004 §2.11 — reason obligatorio para auditoría de overrides.
ALTER TABLE "master"."tenant_features"
  ADD CONSTRAINT "tenant_features_manual_override_reason_check"
  CHECK (
    "source" <> 'manual_override'
    OR ("reason" IS NOT NULL AND length("reason") >= 10)
  );

-- Trigger updated_at.
CREATE TRIGGER "tenant_features_touch_updated_at"
  BEFORE UPDATE ON "master"."tenant_features"
  FOR EACH ROW EXECUTE FUNCTION "master"."touch_updated_at"();
